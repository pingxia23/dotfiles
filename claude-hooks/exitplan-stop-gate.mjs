#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TAG = "[exitplan-gate]";
const LOG_FILE = path.join(os.homedir(), ".claude", "hooks", "exitplan-stop-gate.log");
const log = (msg) => {
  const line = `${new Date().toISOString()} ${TAG} ${msg}\n`;
  process.stderr.write(line);
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
};

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

// ── 4. Hash dedup — skip if plan unchanged since last codex review ──
const planHash = crypto.createHash("md5").update(planContent).digest("hex");
const markerFile = `${planFile}.codex-reviewed`;

if (fs.existsSync(markerFile)) {
  const previousHash = fs.readFileSync(markerFile, "utf8").trim();
  if (previousHash === planHash) {
    log("plan unchanged since last review, removing marker and allowing");
    try { fs.unlinkSync(markerFile); } catch {}
    process.exit(0);
  }
}

log(`plan hash: ${planHash}`);

// ── 5. Codex auth check ──
const authResult = spawnSync("codex", ["login", "status"], {
  encoding: "utf8",
  timeout: 15_000,
});

if (authResult.status !== 0) {
  log(`codex auth check failed (exit ${authResult.status}): ${(authResult.stderr || "").trim()}, allowing`);
  process.exit(0);
}

log("codex auth OK");

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
Set verdict to "approve" if the plan addresses the user's request and the approach is sound.
Set verdict to "revise" only for concrete issues: wrong file paths, missed dependencies,
incorrect assumptions about existing code, or a fundamentally flawed approach.
Do NOT revise for: style nits, minor improvements, alternative approaches that
are merely different (not better), or missing nice-to-haves.
When verdict is "approve", comments must be an empty array.
When verdict is "revise", each comment must describe one concrete issue.
</review_policy>

<grounding_rules>
Ground every comment in repository files or tool outputs you inspected.
Verify file paths exist and code patterns match before flagging an issue.
</grounding_rules>`;

// ── 8. Run codex ──
const tmpFile = path.join(os.tmpdir(), `exitplan-codex-${Date.now()}.txt`);
log(`running codex exec ...`);

const codexResult = spawnSync(
  "codex",
  ["exec", "--output-schema", REVIEW_SCHEMA, "-o", tmpFile, prompt],
  {
    encoding: "utf8",
    timeout: 15 * 60 * 1000,
  }
);

log(`codex exit code: ${codexResult.status}`);

let codexOutput = "";
try {
  codexOutput = fs.readFileSync(tmpFile, "utf8").trim();
  fs.unlinkSync(tmpFile);
} catch (e) {
  log(`failed to read codex output: ${e.message}, allowing`);
  process.exit(0);
}

log(`codex output: ${codexOutput.slice(0, 500)}`);

if (!codexOutput) {
  log("codex produced empty output, allowing");
  process.exit(0);
}

// ── 9. Write hash marker ──
try {
  fs.writeFileSync(markerFile, planHash, "utf8");
  log("wrote hash marker");
} catch (e) {
  log(`failed to write hash marker: ${e.message}`);
}

// ── 10. Parse structured review output ──
let review;
try {
  review = JSON.parse(codexOutput);
} catch {
  log(`failed to parse codex output as JSON, allowing`);
  process.exit(0);
}

if (!review.verdict || !Array.isArray(review.comments)) {
  log(`malformed review output (missing verdict or comments), allowing`);
  process.exit(0);
}

if (review.verdict === "approve") {
  log("verdict: approve, proceeding to user approval");
  process.exit(0);
}

if (review.verdict === "revise") {
  const feedback = review.comments.length > 0
    ? review.comments.map((c, i) => `${i + 1}. ${c}`).join("\n")
    : "No specific comments provided.";
  log(`verdict: revise (${review.comments.length} comments)`);
  process.stderr.write(`Codex review comments on the plan:\n\n${feedback}\n\nAddress the review comments above, update the plan file, then retry ExitPlanMode.`);
  process.exit(2);
}

// Unknown verdict — fail open
log(`unknown verdict "${review.verdict}", allowing`);
process.exit(0);
