#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TAG = "[stop-plan-gate]";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(SCRIPT_DIR, "stop-plan-gate.log");
const REVIEW_SCHEMA_PATH = path.join(
  SCRIPT_DIR,
  "schemas",
  "plan-review-output.schema.json"
);
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const CLAUDE_TIMEOUT_MS = 15 * 60 * 1000;

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
    .filter(({ index }) => index >= bounds.firstIndex && index <= bounds.lastIndex)
    .map(({ raw }) => raw)
    .join("\n");
}

function buildPrompt(
  transcriptPath,
  turnId,
  latestUserRequest,
  latestTurnContext,
  planContent,
  reviewSchema
) {
  return `
Review this implementation plan before it's presented for user approval.
The latest user request , plan content and the latest-turn context are provided below, both extracted
from the transcript. Use them as primary context. 
<latest_user_request>
${latestUserRequest}
</latest_user_request>

<latest_turn_context>
${latestTurnContext}
</latest_turn_context>

<plan>
${planContent}
</plan>

The full transcript file (including latest-turn ${turnId}) is also available at the path below if you need to inspect deeper context during review.
<transcript_path>
${transcriptPath}
</transcript_path>


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
Ground every comment in repository files, transcript contents, or tool outputs you inspected.
Use the provided latest user request and latest turn context as your default context.
Inspect the transcript file at transcript_path if you need deeper supporting context.
Verify file paths exist and code patterns match before flagging an issue.
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

function runClaude(prompt, cwd, reviewSchema) {
  log(`running claude with prompt:\n${prompt}`);
  return spawnSync(
    CLAUDE_BIN,
    [
      "-p",
      "--model",
      "claude-opus-4-6",
      "--no-session-persistence",
      "--allowedTools",
      "Read,Write,Edit,Bash,Glob,Grep,WebFetch,WebSearch",
      "--json-schema",
      reviewSchema,
      prompt,
    ],
    {
      cwd,
      encoding: "utf8",
      timeout: CLAUDE_TIMEOUT_MS,
    }
  );
}

function parseClaudeReview(output) {
  const trimmed = output.trim();
  log(`trimmed claude review output:\n${trimmed}`);
  if (!trimmed) {
    return null;
  }

  const candidates = [trimmed];
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fencedMatch?.[1]) {
    candidates.unshift(fencedMatch[1].trim());
  }

  try {
    for (const candidate of candidates) {
      const parsed = JSON.parse(candidate);
      if (
        parsed &&
        typeof parsed === "object" &&
        typeof parsed.verdict === "string"
      ) {
        return parsed;
      }
    }
  } catch {}

  return null;
}

function buildRevisionPrompt(comments) {
  const feedback =
    comments.length > 0
      ? comments.map((comment, index) => `${index + 1}. ${comment}`).join("\n")
      : "1. No specific comments were provided.";

  return `Revise the implementation plan before presenting it to the user.\n\nAddress these concrete review comments:\n${feedback}`;
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
  } user_chars=${latestUserRequest.length} turn_chars=${latestTurnContext.length}`
);

const reviewSchema = loadReviewSchema();
if (!reviewSchema) {
  allow(`failed to load review schema from ${REVIEW_SCHEMA_PATH}`);
}

const prompt = buildPrompt(
  transcriptPath,
  turnId,
  latestUserRequest,
  latestTurnContext,
  planContent,
  reviewSchema
);
const cwd =
  typeof input.cwd === "string" && fs.existsSync(input.cwd)
    ? input.cwd
    : os.homedir();

log(`running claude in cwd=${cwd}`);
const claudeResult = runClaude(prompt, cwd, reviewSchema);
log(
  `claude exit=${claudeResult.status ?? "null"} signal=${
    claudeResult.signal ?? "null"
  } stderr_chars=${getText(claudeResult.stderr).length}`
);

if (claudeResult.error) {
  allow(`claude spawn failed: ${claudeResult.error.message}`);
}

if (claudeResult.status !== 0) {
  allow(`claude non-zero exit: ${claudeResult.status}`);
}

const review = parseClaudeReview(claudeResult.stdout || "");
if (
  !review ||
  !["approve", "revise"].includes(review.verdict) ||
  !Array.isArray(review.comments)
) {
  log(
    `invalid review stdout=${JSON.stringify(
      (claudeResult.stdout || "").slice(0, 500)
    )}`
  );
  allow("invalid claude review output");
}

if (review.verdict === "approve") {
  allow("review approved");
}

block(buildRevisionPrompt(review.comments));
