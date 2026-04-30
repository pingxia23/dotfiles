#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TAG = "[stop-plan-gate]";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(SCRIPT_DIR, "stop-plan-gate.log");
const REVIEW_SCHEMA_PATH = path.join(
  SCRIPT_DIR,
  "schemas",
  "plan-review-output.schema.json",
);
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-7[1m]";
const CLAUDE_TIMEOUT_MS = 15 * 60 * 1000;
const CODEX_BIN = process.env.CODEX_BIN || "codex";
const CODEX_TIMEOUT_MS = 15 * 60 * 1000;
const CODEX_REASONING_EFFORT = "medium";

function log(message) {
  const line = `${new Date().toISOString()} ${TAG} ${message}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch {}
}

function allow(reason) {
  if (reason) {
    log(`allow: ${reason}`);
  }
  process.stdout.write(JSON.stringify({ continue: true }));
  process.exit(0);
}

function block(reason) {
  log("block: revise requested");
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
}

function readPayload(argv) {
  let payload = "";
  try {
    if (!process.stdin.isTTY) {
      payload = fs.readFileSync(0, "utf8");
    }
  } catch {}

  if (!payload.trim() && argv.length > 0) {
    payload = argv.at(-1) || "";
  }

  if (!payload.trim()) {
    return null;
  }

  try {
    return { raw: payload, parsed: JSON.parse(payload) };
  } catch {
    return { raw: payload, parsed: null };
  }
}

function readTranscriptEntries(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    return [];
  }

  const lines = fs.readFileSync(transcriptPath, "utf8").split("\n");
  const entries = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }

    try {
      entries.push({ index, raw: line, entry: JSON.parse(line) });
    } catch {}
  }

  return entries;
}

function getText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function findPlanForTurn(entries, turnId) {
  let match = null;

  for (const { index, entry } of entries) {
    if (entry?.type !== "event_msg" || !entry.payload) {
      continue;
    }

    if (entry.payload.type !== "item_completed") {
      continue;
    }

    if (entry.payload.turn_id !== turnId) {
      continue;
    }

    if (entry.payload.item?.type !== "Plan") {
      continue;
    }

    const text = getText(entry.payload.item.text);
    if (!text) {
      continue;
    }

    match = { index, text };
  }

  return match;
}

function findLatestUserRequest(entries) {
  let latestUserRequest = "";

  for (const { entry } of entries) {
    if (entry?.type !== "event_msg" || !entry.payload) {
      continue;
    }

    if (entry.payload.type !== "user_message") {
      continue;
    }

    const text = getText(entry.payload.message);
    if (text) {
      latestUserRequest = text;
    }
  }

  return latestUserRequest;
}

function findTurnBounds(entries, turnId) {
  let firstIndex = null;
  let lastIndex = null;

  for (const { index, raw } of entries) {
    if (!raw.includes(turnId)) {
      continue;
    }

    if (firstIndex === null) {
      firstIndex = index;
    }

    lastIndex = index;
  }

  if (firstIndex === null || lastIndex === null) {
    return null;
  }

  return { firstIndex, lastIndex };
}

function buildTurnContext(entries, bounds) {
  return entries
    .filter(
      ({ index }) => index >= bounds.firstIndex && index <= bounds.lastIndex,
    )
    .map(({ raw }) => raw)
    .join("\n");
}

function buildPrompt(
  transcriptPath,
  turnId,
  latestUserRequest,
  planContent,
  reviewSchema,
) {
  return `
Review this implementation plan before it's presented for user approval.
The latest user request , plan content and the latest-turn context are provided below, both extracted
from the transcript. Use them as primary context. 
<latest_user_request>
${latestUserRequest}
</latest_user_request>

<plan>
${planContent}
</plan>

<latest_turn_context>
The full transcript is available at the path ${transcriptPath}. To locate the latest turn context from the transcript, search for ${turnId} and review the lines between its first and last occurrence.
</latest_turn_context>


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
</grounding_rules>

<output_schema>
${reviewSchema}
</output_schema>

Return exactly one JSON object matching output_schema.
Do not include markdown fences or any prose before or after the JSON object.`;
}

function loadReviewSchema() {
  try {
    return fs.readFileSync(REVIEW_SCHEMA_PATH, "utf8").trim();
  } catch (error) {
    return null;
  }
}

function spawnWithTimeout(command, args, options) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let timeout = null;

    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    const settle = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      resolve({
        stdout,
        stderr,
        ...result,
      });
    };

    timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) {
          child.kill("SIGKILL");
        }
      }, 5_000).unref();
    }, options.timeout);
    timeout.unref();

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      settle({ status: null, signal: null, error });
    });
    child.on("close", (status, signal) => {
      settle({
        status,
        signal,
        error: timedOut
          ? new Error(`timed out after ${options.timeout}ms`)
          : null,
      });
    });
  });
}

function isReviewObject(value) {
  return (
    value &&
    typeof value === "object" &&
    ["approve", "revise"].includes(value.verdict) &&
    Array.isArray(value.comments)
  );
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function parseClaudeReviewOutput(output) {
  const parsed = parseJsonObject(output);
  if (!parsed) {
    return null;
  }

  if (
    parsed.structured_output &&
    typeof parsed.structured_output === "object" &&
    isReviewObject(parsed.structured_output)
  ) {
    return parsed.structured_output;
  }

  return null;
}

async function reviewPlanWithClaude(prompt, cwd, reviewSchema) {
  log(`running claude in cwd=${cwd}`);
  const claudeResult = await spawnWithTimeout(
    CLAUDE_BIN,
    [
      "-p",
      "--model",
      CLAUDE_MODEL,
      "--no-session-persistence",
      "--allowedTools",
      "Read,Write,Edit,Bash,Glob,Grep,WebFetch,WebSearch",
      "--output-format",
      "json",
      "--json-schema",
      reviewSchema,
      prompt,
    ],
    {
      cwd,
      timeout: CLAUDE_TIMEOUT_MS,
    },
  );
  log(
    `claude exit=${claudeResult.status ?? "null"} signal=${
      claudeResult.signal ?? "null"
    } stderr_chars=${getText(claudeResult.stderr).length}`,
  );

  if (claudeResult.error) {
    return {
      review: null,
      reason: `claude spawn failed: ${claudeResult.error.message}`,
    };
  }

  if (claudeResult.status !== 0) {
    return {
      review: null,
      reason: `claude non-zero exit: ${claudeResult.status}`,
    };
  }

  const trimmed = (claudeResult.stdout || "").trim();
  log(`trimmed claude review output:\n${trimmed}`);

  const review = parseClaudeReviewOutput(trimmed);

  if (
    !review ||
    !["approve", "revise"].includes(review.verdict) ||
    !Array.isArray(review.comments)
  ) {
    log(
      `invalid claude review stdout=${JSON.stringify(
        (claudeResult.stdout || "").slice(0, 500),
      )}`,
    );
    return { review: null, reason: "invalid claude review output" };
  }

  return { review, reason: null };
}

async function reviewPlanWithCodex(prompt, cwd) {
  const authResult = spawnSync(CODEX_BIN, ["login", "status"], {
    cwd,
    encoding: "utf8",
    timeout: 15_000,
  });
  log(
    `codex auth exit=${authResult.status ?? "null"} signal=${
      authResult.signal ?? "null"
    } stderr_chars=${getText(authResult.stderr).length}`,
  );

  if (authResult.error) {
    return {
      review: null,
      reason: `codex auth spawn failed: ${authResult.error.message}`,
    };
  }

  if (authResult.status !== 0) {
    return {
      review: null,
      reason: `codex auth check failed: ${getText(authResult.stderr) || authResult.status}`,
    };
  }

  const tmpFile = path.join(
    os.tmpdir(),
    `stop-plan-gate-codex-${Date.now()}-${process.pid}.json`,
  );

  log(`running codex in cwd=${cwd}`);
  const codexResult = await spawnWithTimeout(
    CODEX_BIN,
    [
      "exec",
      "-c",
      `model_reasoning_effort="${CODEX_REASONING_EFFORT}"`,
      "--output-schema",
      REVIEW_SCHEMA_PATH,
      "-o",
      tmpFile,
      prompt,
    ],
    {
      cwd,
      timeout: CODEX_TIMEOUT_MS,
    },
  );
  log(
    `codex exit=${codexResult.status ?? "null"} signal=${
      codexResult.signal ?? "null"
    } stderr_chars=${getText(codexResult.stderr).length}`,
  );

  if (codexResult.error) {
    try {
      fs.unlinkSync(tmpFile);
    } catch {}
    return {
      review: null,
      reason: `codex spawn failed: ${codexResult.error.message}`,
    };
  }

  if (codexResult.status !== 0) {
    try {
      fs.unlinkSync(tmpFile);
    } catch {}
    return {
      review: null,
      reason: `codex non-zero exit: ${codexResult.status}`,
    };
  }

  let output = "";
  try {
    output = fs.readFileSync(tmpFile, "utf8").trim();
  } catch (error) {
    return {
      review: null,
      reason: `failed to read codex output: ${error.message}`,
    };
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {}
  }

  log(`trimmed codex review output:\n${output}`);

  let review = null;
  if (output) {
    try {
      const parsed = JSON.parse(output);
      if (
        parsed &&
        typeof parsed === "object" &&
        typeof parsed.verdict === "string"
      ) {
        review = parsed;
      }
    } catch {}
  }

  if (
    !review ||
    !["approve", "revise"].includes(review.verdict) ||
    !Array.isArray(review.comments)
  ) {
    log(`invalid codex review stdout=${JSON.stringify(output.slice(0, 500))}`);
    return { review: null, reason: "invalid codex review output" };
  }

  return { review, reason: null };
}

function buildRevisionPrompt(comments) {
  const feedback =
    comments.length > 0
      ? comments.map((comment, index) => `${index + 1}. ${comment}`).join("\n")
      : "1. No specific comments were provided.";

  return `Revise the implementation plan before presenting it to the user.\n\nAddress these concrete review comments:\n${feedback}`;
}

function mergeReviewComments(reviews) {
  const comments = [];
  const seen = new Set();

  for (const { reviewer, review } of reviews) {
    if (!review || review.verdict !== "revise") {
      continue;
    }

    for (const rawComment of review.comments) {
      const comment = getText(rawComment);
      if (!comment) {
        continue;
      }

      const key = comment.toLowerCase().replace(/\s+/g, " ");
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      comments.push(`[${reviewer}] ${comment}`);
    }
  }

  return comments;
}

function runReviewer(reviewer, reviewPromise) {
  return reviewPromise
    .then((result) => ({
      reviewer,
      ...result,
    }))
    .catch((error) => ({
      reviewer,
      review: null,
      reason: `${reviewer.toLowerCase()} review failed: ${error.message}`,
    }));
}

const payload = readPayload(process.argv.slice(2));
if (!payload) {
  allow("failed to parse stop payload");
}

log(`raw stop payload:\n${payload.raw}`);

const input = payload.parsed;
if (!input) {
  allow("failed to parse stop payload");
}

const sessionId = input.session_id || "unknown";
const turnId = input.turn_id || "unknown";
log(`received: session=${sessionId} turn=${turnId}`);

if (input.stop_hook_active === true) {
  allow("skip stop_hook_active continuation");
}

const transcriptPath =
  typeof input.transcript_path === "string" ? input.transcript_path : "";
const transcriptEntries = readTranscriptEntries(transcriptPath);
if (!transcriptPath || transcriptEntries.length === 0) {
  allow("skip missing transcript");
}

const planMatch = findPlanForTurn(transcriptEntries, turnId);
if (!planMatch) {
  allow("skip no plan item for current turn");
}

const planContent = planMatch.text;
const latestUserRequest = findLatestUserRequest(transcriptEntries);
const turnBounds = findTurnBounds(transcriptEntries, turnId);
if (!turnBounds) {
  allow("skip missing turn bounds");
}

const latestTurnContext = buildTurnContext(transcriptEntries, turnBounds);
if (!latestTurnContext) {
  allow("skip empty latest turn context");
}

log(
  `context: transcript=present entries=${transcriptEntries.length} plan_index=${
    planMatch.index
  } turn_bounds=${turnBounds.firstIndex}-${turnBounds.lastIndex} plan_chars=${
    planContent.length
  } user_chars=${latestUserRequest.length} turn_chars=${latestTurnContext.length}`,
);

const reviewSchema = loadReviewSchema();
if (!reviewSchema) {
  allow(`failed to load review schema from ${REVIEW_SCHEMA_PATH}`);
}

const prompt = buildPrompt(
  transcriptPath,
  turnId,
  latestUserRequest,
  planContent,
  reviewSchema,
);
const cwd =
  typeof input.cwd === "string" && fs.existsSync(input.cwd)
    ? input.cwd
    : os.homedir();

const claudeReview = runReviewer(
  "Claude",
  reviewPlanWithClaude(prompt, cwd, reviewSchema),
);
const codexReview = runReviewer("Codex", reviewPlanWithCodex(prompt, cwd));
const reviewerResults = await Promise.all([codexReview, claudeReview]);

for (const { reviewer, review, reason } of reviewerResults) {
  if (review) {
    log(
      `${reviewer} verdict: ${review.verdict} (${review.comments.length} comments)`,
    );
  } else {
    log(`${reviewer} review unavailable: ${reason || "invalid review output"}`);
  }
}

const validReviews = reviewerResults.filter(({ review }) => review);
if (validReviews.length === 0) {
  allow(
    reviewerResults
      .map(
        ({ reviewer, reason }) =>
          `${reviewer}: ${reason || "invalid review output"}`,
      )
      .join("; "),
  );
}

const revisionComments = mergeReviewComments(validReviews);
if (revisionComments.length === 0) {
  allow("all valid reviews approved");
}

block(buildRevisionPrompt(revisionComments));
