#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TAG = "[exitplan-gate]";
const LOG_FILE = path.join(os.homedir(), ".claude", "hooks", "exitplan-stop-gate.log");
const STATE_OWNER = typeof process.getuid === "function"
  ? `uid-${process.getuid()}`
  : `user-${os.userInfo().username.replace(/[^a-zA-Z0-9_.-]/g, "_")}`;
const STATE_DIR = path.join(os.tmpdir(), "claude-exitplan-stop-gate", STATE_OWNER);
const MAX_CODEX_REVIEWS = 2;
const log = (msg) => {
  const line = `${new Date().toISOString()} ${TAG} ${msg}\n`;
  process.stderr.write(line);
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
};

function stateFileFor(sessionId, planFile) {
  const stateKey = `${sessionId}:${planFile}`;
  const stateHash = crypto.createHash("sha256").update(stateKey).digest("hex");
  return path.join(STATE_DIR, `${stateHash}.json`);
}

function readReviewAttempts(stateFile) {
  try {
    if (!fs.existsSync(stateFile)) {
      return 0;
    }

    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    return Number.isInteger(state?.attempts) && state.attempts > 0 ? state.attempts : 0;
  } catch (e) {
    log(`failed to read attempt state: ${e.message}; treating as no attempts`);
    return 0;
  }
}

function writeReviewAttempts(stateFile, sessionId, planFile, attempts) {
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      stateFile,
      JSON.stringify({
        attempts,
        sessionId,
        planFilePath: planFile,
        updatedAt: new Date().toISOString(),
      }),
      "utf8"
    );
    log(`wrote attempt state: ${attempts}/${MAX_CODEX_REVIEWS}`);
    return true;
  } catch (e) {
    log(`failed to write attempt state: ${e.message}`);
    return false;
  }
}

function clearReviewAttempts(stateFile) {
  try {
    if (fs.existsSync(stateFile)) {
      fs.unlinkSync(stateFile);
      log("cleared attempt state");
    }
  } catch (e) {
    log(`failed to clear attempt state: ${e.message}`);
  }
}

function reviewPlanWithCodex(prompt, reviewSchemaPath) {
  const authResult = spawnSync("codex", ["login", "status"], {
    encoding: "utf8",
    timeout: 15_000,
  });

  if (authResult.error) {
    return { review: null, reason: `codex auth spawn failed: ${authResult.error.message}` };
  }

  if (authResult.status !== 0) {
    return {
      review: null,
      reason: `codex auth check failed (exit ${authResult.status}): ${(authResult.stderr || "").trim()}`,
    };
  }

  log("codex auth OK");

  const tmpFile = path.join(os.tmpdir(), `exitplan-codex-${Date.now()}-${process.pid}.txt`);
  log("running codex exec ...");

  const codexResult = spawnSync(
    "codex",
    [
      "exec",
      "-c",
      'model_reasoning_effort="medium"',
      "--output-schema",
      reviewSchemaPath,
      "-o",
      tmpFile,
      prompt,
    ],
    {
      encoding: "utf8",
      timeout: 15 * 60 * 1000,
    }
  );

  log(`codex exit code: ${codexResult.status}`);

  if (codexResult.error) {
    try { fs.unlinkSync(tmpFile); } catch {}
    return { review: null, reason: `codex spawn failed: ${codexResult.error.message}` };
  }

  if (codexResult.status !== 0) {
    try { fs.unlinkSync(tmpFile); } catch {}
    return { review: null, reason: `codex non-zero exit: ${codexResult.status}` };
  }

  let codexOutput = "";
  try {
    codexOutput = fs.readFileSync(tmpFile, "utf8").trim();
  } catch (e) {
    return { review: null, reason: `failed to read codex output: ${e.message}` };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }

  log(`codex output: ${codexOutput.slice(0, 500)}`);

  if (!codexOutput) {
    return { review: null, reason: "codex produced empty output" };
  }

  let review;
  try {
    review = JSON.parse(codexOutput);
  } catch {
    return { review: null, reason: "failed to parse codex output as JSON" };
  }

  if (!review?.verdict || !Array.isArray(review.comments)) {
    return { review: null, reason: "malformed review output (missing verdict or comments)" };
  }

  return { review, reason: null };
}

// ── 1. Read PreToolUse hook input from stdin ──
let input;
try {
  input = JSON.parse(fs.readFileSync(0, "utf8").trim() || "{}");
} catch {
  log("failed to parse stdin, allowing");
  process.exit(0);
}

log(`input received: ${input}`);

const transcriptPath = input.transcript_path;
if (!transcriptPath || !fs.existsSync(transcriptPath)) {
  log("no transcript path or file missing, allowing");
  process.exit(0);
}

// ── 2. Extract plan from tool_input (authoritative, no heuristics) ──
// ExitPlanMode's tool_input provides both planFilePath and plan content directly.
const toolInput = input.tool_input || {};
const planFile = toolInput.planFilePath;
const planContent = toolInput.plan;

if (!planFile || !planContent?.trim()) {
  log(`no plan in tool_input (planFilePath=${planFile ?? "missing"}), allowing`);
  process.exit(0);
}

log(`plan file: ${planFile} (${planContent.length} chars)`);

// ── 4. Bound Codex review attempts by session + plan file ──
const sessionId = input.session_id;
if (!sessionId) {
  log("no session_id, allowing");
  process.exit(0);
}

const stateFile = stateFileFor(sessionId, planFile);
log(`state file path: ${stateFile}`)
const previousAttempts = readReviewAttempts(stateFile);

if (previousAttempts >= MAX_CODEX_REVIEWS) {
  const message = `Codex plan review already requested ${MAX_CODEX_REVIEWS} revisions for this plan; allowing user review.`;
  log(message);
  clearReviewAttempts(stateFile);
  process.stdout.write(JSON.stringify({ systemMessage: message }));
  process.exit(0);
}

log(`codex review attempt: ${previousAttempts + 1}/${MAX_CODEX_REVIEWS}`);

// ── 6. Build context — extract last user message + last assistant message ──
const transcriptLines = fs.readFileSync(transcriptPath, "utf8").trim().split("\n");
let userRequest = "";
let claudeResponse = "";

for (let i = transcriptLines.length - 1; i >= 0; i--) {
  try {
    const entry = JSON.parse(transcriptLines[i]);
    if (entry.type === "human" && entry.message?.content) {
      const text = entry.message.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      if (text.trim()) {
        userRequest = text;
        break;
      }
    }
  } catch {}
}

for (let i = transcriptLines.length - 1; i >= 0; i--) {
  try {
    const entry = JSON.parse(transcriptLines[i]);
    if (entry.type === "assistant" && entry.message?.content) {
      const text = entry.message.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      if (text.trim()) {
        claudeResponse = text;
        break;
      }
    }
  } catch {}
}

// ── 7. Build prompt ──
const REVIEW_SCHEMA = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "schemas",
  "plan-review-output.schema.json"
);

const prompt = `<task>
Review this implementation plan before it's presented for user approval.
The user's last request and Claude's last response are provided for context.

<user_request>
${userRequest}
</user_request>

<claude_last_response>
${claudeResponse}
</claude_last_response>

<plan>
${planContent}
</plan>

The full transcript file is also available at the path below if you need to inspect deeper context during review.
<transcript_path>
${transcriptPath}
</transcript_path>
</task>

<review_policy>
  Default to skepticism. Actively try to disprove the change by searching for broken invariants, missing guards, unhandled error paths, race conditions, invalid assumptions, and cases where the proposal stops being correct under stress, retries, partial failure, or unexpected input.

  Set verdict to "approve" only when all of the following are true:
  - the plan fully addresses the user's request
  - the approach is technically sound
  - there are no concrete, material correctness risks you can identify
  - any required dependencies, file paths, and assumptions are consistent with the described codebase

  Set verdict to "revise" if you identify any concrete, material issue, including:
  - incorrect file paths
  - missed dependencies
  - incorrect assumptions about the existing code
  - missing guards or validation
  - unhandled failure cases
  - broken invariants
  - a fundamentally flawed approach

  Do NOT set verdict to "revise" for:
  - style feedback
  - naming feedback
  - low-value cleanup
  - minor optimizations
  - alternative approaches that are merely different
  - missing nice-to-haves
  - speculative concerns not grounded in the diff or surrounding context

  Prefer "revise" over "approve" when a concrete correctness concern exists.
</review_policy>

<finding_bar>
  Report only concrete, material, evidence-based findings that are directly tied to the proposed change and significant enough to cause incorrect behavior, regressions, operational risk, or blocked delivery.

  Each finding must answer:
  1. What can go wrong?
  2. What in the change makes this path vulnerable?
  3. What is the likely impact?
  4. What concrete change would reduce or eliminate the risk?
</finding_bar>

<structured_output_contract>
  When verdict is "approve", comments must be an empty array.
  When verdict is "revise", each comment must describe exactly one concrete issue.
</structured_output_contract>

<grounding_rules>
Ground every comment in repository files or tool outputs you inspected.
Verify file paths exist and code patterns match before flagging an issue.
Do not invent files, lines, code paths, incidents, attack chains, or runtime behavior you cannot support. If a conclusion depends on an inference, state that explicitly in the finding body and keep the confidence honest.
</grounding_rules>`;

const { review, reason } = reviewPlanWithCodex(prompt, REVIEW_SCHEMA);
if (!review) {
  log(`${reason}, allowing`);
  process.exit(0);
}

if (review.verdict === "approve") {
  log("verdict: approve, proceeding to user approval");
  clearReviewAttempts(stateFile);
  process.exit(0);
}

if (review.verdict === "revise") {
  const feedback = review.comments.length > 0
    ? review.comments.map((c, i) => `${i + 1}. ${c}`).join("\n")
    : "No specific comments provided.";
  log(`verdict: revise (${review.comments.length} comments)`);
  if (!writeReviewAttempts(stateFile, sessionId, planFile, previousAttempts + 1)) {
    const message = "Codex requested plan revision, but retry state could not be persisted; allowing user review to avoid an unbounded retry loop.";
    process.stdout.write(JSON.stringify({ systemMessage: message }));
    process.exit(0);
  }
  process.stderr.write(`Codex review comments on the plan:\n\n${feedback}\n\nAddress the review comments above, update the plan file, then retry ExitPlanMode.`);
  process.exit(2);
}

// Unknown verdict — fail open
log(`unknown verdict "${review.verdict}", allowing`);
process.exit(0);
