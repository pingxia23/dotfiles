#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildReviewInstructions,
  createLogger,
  getText,
  loadReviewSchema,
  mergeReviewComments,
  runPlanReviewers,
} from "./shared.mjs";

const TAG = "[stop-plan-gate]";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(SCRIPT_DIR, "codex-stop-plan-gate.log");
const REVIEW_SCHEMA_PATH = path.join(
  SCRIPT_DIR,
  "plan-review-output.schema.json",
);
const log = createLogger({ tag: TAG, logFile: LOG_FILE });

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

function findRecentUserInputs(entries, beforeIndex, limit = 10) {
  const userInputs = [];

  for (let entryIndex = entries.length - 1; entryIndex >= 0; entryIndex -= 1) {
    const { index: transcriptIndex, entry } = entries[entryIndex];
    if (transcriptIndex >= beforeIndex) {
      continue;
    }

    if (entry?.type !== "event_msg" || !entry.payload) {
      continue;
    }

    if (entry.payload.type !== "user_message") {
      continue;
    }

    const text = getText(entry.payload.message);
    if (text) {
      userInputs.push(text);
      if (userInputs.length >= limit) {
        break;
      }
    }
  }

  return userInputs.reverse();
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

function buildPrompt({
  transcriptPath,
  turnId,
  latestUserRequest,
  recentUserInputs,
  planContent,
  latestTurnContext,
  reviewSchema,
}) {
  const recentUserInputsText =
    recentUserInputs.length > 0
      ? recentUserInputs.map((text, index) => `${index + 1}. ${text}`).join("\n\n")
      : "No prior user inputs found.";

  return `
Review this implementation plan before it's presented for user approval.
The latest user request, recent user inputs, plan content, and the latest-turn context are provided
below, all extracted from the transcript. Use them as primary context.
<latest_user_request>
${latestUserRequest}
</latest_user_request>

<recent_user_inputs>
These are at most the last 10 user inputs from this session before the plan, oldest to newest.
Use them to detect whether the plan ignored explicit user constraints, corrections, or scope
boundaries. When these conflict, newer user inputs take priority.

${recentUserInputsText}
</recent_user_inputs>

<plan>
${planContent}
</plan>

<latest_turn_context>
${latestTurnContext}
</latest_turn_context>

The full transcript is also available at ${transcriptPath}. To inspect deeper context, search for ${turnId}
and review nearby transcript lines.

${buildReviewInstructions(reviewSchema)}`;
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
const recentUserInputs = findRecentUserInputs(
  transcriptEntries,
  planMatch.index,
);
const latestUserRequest = recentUserInputs.at(-1) || "";
const turnBounds = findTurnBounds(transcriptEntries, turnId);
if (!turnBounds) {
  allow("skip missing turn bounds");
}

const latestTurnContext = buildTurnContext(transcriptEntries, turnBounds);
if (!latestTurnContext) {
  allow("skip empty latest turn context");
}

const reviewSchema = loadReviewSchema(REVIEW_SCHEMA_PATH);
if (!reviewSchema) {
  allow(`failed to load review schema from ${REVIEW_SCHEMA_PATH}`);
}

const prompt = buildPrompt({
  transcriptPath,
  turnId,
  latestUserRequest,
  recentUserInputs,
  planContent,
  latestTurnContext,
  reviewSchema,
});
const cwd =
  typeof input.cwd === "string" && fs.existsSync(input.cwd)
    ? input.cwd
    : os.homedir();

const reviewerResults = await runPlanReviewers({
  prompt,
  cwd,
  reviewSchemaPath: REVIEW_SCHEMA_PATH,
  log,
  codexTempPrefix: "stop-plan-gate-codex",
});

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
