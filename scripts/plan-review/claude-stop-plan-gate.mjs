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

const TAG = "[claude-stop-plan-gate]";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(SCRIPT_DIR, "claude-stop-plan-gate.log");
const REVIEW_SCHEMA_PATH = path.join(
  SCRIPT_DIR,
  "plan-review-output.schema.json",
);
const PLAN_PATH_MARKER = `${path.sep}.claude${path.sep}plans${path.sep}`;
const log = createLogger({ tag: TAG, logFile: LOG_FILE, stderr: true });

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

function readPayload() {
  let raw = "";
  try {
    raw = fs.readFileSync(0, "utf8");
  } catch {}

  if (!raw.trim()) {
    return null;
  }

  try {
    return { raw, parsed: JSON.parse(raw) };
  } catch (error) {
    log(`failed to parse stop payload: ${error.message}`);
    return { raw, parsed: null };
  }
}

function readTranscriptEntries(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    return [];
  }

  const lines = fs.readFileSync(transcriptPath, "utf8").split("\n");
  const entries = [];

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]?.trim();
    if (!raw) {
      continue;
    }

    try {
      entries.push({ index, raw, entry: JSON.parse(raw) });
    } catch (error) {
      log(`failed to parse transcript line ${index + 1}: ${error.message}`);
    }
  }

  return entries;
}

function textFromContent(content) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter((item) => item.type === "text")
    .map((item) => item.text || "")
    .join("\n")
    .trim();
}

function toolContent(entry) {
  return Array.isArray(entry?.message?.content) ? entry.message.content : [];
}

function isMainConversationEntry(entry) {
  return !entry.parent_tool_use_id && !entry.subagent_type;
}

function isRealUserText(entry) {
  if (!isMainConversationEntry(entry)) {
    return false;
  }

  if (entry?.type !== "user" || entry.message?.role !== "user") {
    return false;
  }

  const content = toolContent(entry);
  if (content.some((item) => item.type === "tool_result")) {
    return false;
  }

  return Boolean(textFromContent(entry.message.content));
}

function findLatestRealUserIndex(entries) {
  for (let entryIndex = entries.length - 1; entryIndex >= 0; entryIndex -= 1) {
    if (isRealUserText(entries[entryIndex].entry)) {
      return entries[entryIndex].index;
    }
  }

  return null;
}

function readPlanFile(planFilePath) {
  try {
    if (planFilePath && fs.existsSync(planFilePath)) {
      return fs.readFileSync(planFilePath, "utf8");
    }
  } catch (error) {
    log(`failed to read plan file ${planFilePath}: ${error.message}`);
  }

  return "";
}

function findPlanContentForFile(entries, planFilePath, beforeIndex) {
  if (!planFilePath) {
    return "";
  }

  for (let entryIndex = entries.length - 1; entryIndex >= 0; entryIndex -= 1) {
    const { index, entry } = entries[entryIndex];
    if (index > beforeIndex || !isMainConversationEntry(entry)) {
      continue;
    }

    const result = entry.toolUseResult || entry.tool_use_result;
    if (
      result &&
      typeof result === "object" &&
      result.filePath === planFilePath &&
      typeof result.content === "string" &&
      result.content.trim()
    ) {
      return result.content;
    }

    for (const item of toolContent(entry)) {
      if (
        item.type === "tool_use" &&
        item.name === "Write" &&
        item.input?.file_path === planFilePath &&
        typeof item.input.content === "string" &&
        item.input.content.trim()
      ) {
        return item.input.content;
      }
    }
  }

  return readPlanFile(planFilePath);
}

function findLatestExitPlan(entries, latestUserIndex) {
  let match = null;

  for (const { index, entry } of entries) {
    if (latestUserIndex !== null && index <= latestUserIndex) {
      continue;
    }

    if (!isMainConversationEntry(entry)) {
      continue;
    }

    for (const item of toolContent(entry)) {
      if (item.type !== "tool_use" || item.name !== "ExitPlanMode") {
        continue;
      }

      const planFilePath = getText(item.input?.planFilePath);
      const inlinePlan = getText(item.input?.plan);
      const plan =
        inlinePlan || findPlanContentForFile(entries, planFilePath, index);

      if (!plan) {
        log(`found ExitPlanMode at line ${index + 1}, but plan content is empty`);
        continue;
      }

      match = {
        index,
        plan,
        planFilePath,
        source: inlinePlan ? "ExitPlanMode input" : "plan file fallback",
      };
    }
  }

  return match;
}

function findRecentUserInputs(entries, beforeIndex, limit = 10) {
  const userInputs = [];

  for (let entryIndex = entries.length - 1; entryIndex >= 0; entryIndex -= 1) {
    const { index, entry } = entries[entryIndex];
    if (index >= beforeIndex || !isRealUserText(entry)) {
      continue;
    }

    const text = textFromContent(entry.message.content);
    if (text) {
      userInputs.push(text);
      if (userInputs.length >= limit) {
        break;
      }
    }
  }

  return userInputs.reverse();
}

function findLatestAssistantText(entries, beforeIndex) {
  for (let entryIndex = entries.length - 1; entryIndex >= 0; entryIndex -= 1) {
    const { index, entry } = entries[entryIndex];
    if (index >= beforeIndex || !isMainConversationEntry(entry)) {
      continue;
    }

    if (entry?.type !== "assistant" || entry.message?.role !== "assistant") {
      continue;
    }

    const text = textFromContent(entry.message.content);
    if (text) {
      return text;
    }
  }

  return "";
}

function buildLatestTurnContext(entries, latestUserIndex, planIndex) {
  if (latestUserIndex === null) {
    return entries
      .filter(({ index }) => index <= planIndex)
      .map(({ raw }) => raw)
      .join("\n");
  }

  return entries
    .filter(({ index }) => index >= latestUserIndex && index <= planIndex)
    .map(({ raw }) => raw)
    .join("\n");
}

function buildPrompt({
  transcriptPath,
  latestUserRequest,
  recentUserInputs,
  claudeResponse,
  planContent,
  latestTurnContext,
  reviewSchema,
}) {
  const recentUserInputsText =
    recentUserInputs.length > 0
      ? recentUserInputs.map((text, index) => `${index + 1}. ${text}`).join("\n\n")
      : "No prior user inputs found.";

  return `<task>
Review this implementation plan before it's presented for user approval.
The latest user request, recent user inputs, Claude's latest text before ExitPlanMode,
the plan content, and the latest-turn context are provided below.

<latest_user_request>
${latestUserRequest}
</latest_user_request>

<recent_user_inputs>
These are at most the last 10 user inputs from this session before the plan, oldest to newest.
Use them to detect whether the plan ignored explicit user constraints, corrections, or scope
boundaries. When these conflict, newer user inputs take priority.

${recentUserInputsText}
</recent_user_inputs>

<claude_latest_text_before_plan>
${claudeResponse}
</claude_latest_text_before_plan>

<plan>
${planContent}
</plan>

<latest_turn_context>
${latestTurnContext}
</latest_turn_context>

The full transcript file is also available at:
${transcriptPath}
</task>

${buildReviewInstructions(reviewSchema)}`;
}

function buildRevisionPrompt(comments) {
  const feedback =
    comments.length > 0
      ? comments.map((comment, index) => `${index + 1}. ${comment}`).join("\n")
      : "1. No specific comments were provided.";

  return `Revise the implementation plan before presenting it to the user.\n\nAddress these concrete review comments:\n${feedback}`;
}

const payload = readPayload();
if (!payload) {
  allow("missing stop payload");
}

log(`raw stop payload:\n${payload.raw}`);

const input = payload.parsed;
if (!input) {
  allow("invalid stop payload");
}

log(
  `received: session=${input.session_id || "unknown"} event=${
    input.hook_event_name || "unknown"
  } cwd=${input.cwd || "unknown"}`,
);

if (input.stop_hook_active === true) {
  allow("skip stop_hook_active continuation");
}

const transcriptPath =
  typeof input.transcript_path === "string" ? input.transcript_path : "";
const entries = readTranscriptEntries(transcriptPath);
if (!transcriptPath || entries.length === 0) {
  allow("skip missing transcript");
}

const latestUserIndex = findLatestRealUserIndex(entries);
const planMatch = findLatestExitPlan(entries, latestUserIndex);
if (!planMatch) {
  allow("skip no ExitPlanMode plan after latest user prompt");
}

if (!planMatch.planFilePath.includes(PLAN_PATH_MARKER)) {
  log(`non-standard plan path: ${planMatch.planFilePath || "missing"}`);
}

log(
  `plan match: line=${planMatch.index + 1} source=${planMatch.source} file=${
    planMatch.planFilePath || "missing"
  } chars=${planMatch.plan.length}`,
);

const reviewSchema = loadReviewSchema(REVIEW_SCHEMA_PATH);
if (!reviewSchema) {
  allow(`failed to load review schema from ${REVIEW_SCHEMA_PATH}`);
}

const recentUserInputs = findRecentUserInputs(entries, planMatch.index);
const latestUserRequest = recentUserInputs.at(-1) || "";
const latestTurnContext = buildLatestTurnContext(
  entries,
  latestUserIndex,
  planMatch.index,
);
const claudeResponse = findLatestAssistantText(entries, planMatch.index);
const prompt = buildPrompt({
  transcriptPath,
  latestUserRequest,
  recentUserInputs,
  claudeResponse,
  planContent: planMatch.plan,
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
  reviewSchema,
  reviewSchemaPath: REVIEW_SCHEMA_PATH,
  log,
  codexTempPrefix: "claude-stop-plan-gate-codex",
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
