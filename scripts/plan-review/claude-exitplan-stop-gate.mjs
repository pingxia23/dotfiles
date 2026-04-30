#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildReviewInstructions,
  createLogger,
  loadReviewSchema,
  mergeReviewComments,
  runPlanReviewers,
} from "./shared.mjs";

const TAG = "[exitplan-gate]";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REVIEW_SCHEMA_PATH = path.join(
  SCRIPT_DIR,
  "plan-review-output.schema.json",
);
const LOG_FILE = path.join(SCRIPT_DIR, "claude-exitplan-stop-gate.log");
const STATE_OWNER =
  typeof process.getuid === "function"
    ? `uid-${process.getuid()}`
    : `user-${os.userInfo().username.replace(/[^a-zA-Z0-9_.-]/g, "_")}`;
const STATE_DIR = path.join(
  os.tmpdir(),
  "claude-exitplan-stop-gate",
  STATE_OWNER,
);
const MAX_PLAN_REVIEWS = 2;
const log = createLogger({ tag: TAG, logFile: LOG_FILE, stderr: true });

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
    return Number.isInteger(state?.attempts) && state.attempts > 0
      ? state.attempts
      : 0;
  } catch (error) {
    log(`failed to read attempt state: ${error.message}; treating as no attempts`);
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
      "utf8",
    );
    log(`wrote attempt state: ${attempts}/${MAX_PLAN_REVIEWS}`);
    return true;
  } catch (error) {
    log(`failed to write attempt state: ${error.message}`);
    return false;
  }
}

function clearReviewAttempts(stateFile) {
  try {
    if (fs.existsSync(stateFile)) {
      fs.unlinkSync(stateFile);
      log("cleared attempt state");
    }
  } catch (error) {
    log(`failed to clear attempt state: ${error.message}`);
  }
}

function readHookInput() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8").trim() || "{}");
  } catch {
    log("failed to parse stdin, allowing");
    process.exit(0);
  }
}

function extractTextContent(content) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

function readLatestTranscriptContext(transcriptPath) {
  const transcriptLines = fs.readFileSync(transcriptPath, "utf8").trim().split("\n");
  let userRequest = "";
  let claudeResponse = "";

  for (let index = transcriptLines.length - 1; index >= 0; index -= 1) {
    try {
      const entry = JSON.parse(transcriptLines[index]);
      if (entry.type === "human" && entry.message?.content) {
        const text = extractTextContent(entry.message.content);
        if (text.trim()) {
          userRequest = text;
          break;
        }
      }
    } catch {}
  }

  for (let index = transcriptLines.length - 1; index >= 0; index -= 1) {
    try {
      const entry = JSON.parse(transcriptLines[index]);
      if (entry.type === "assistant" && entry.message?.content) {
        const text = extractTextContent(entry.message.content);
        if (text.trim()) {
          claudeResponse = text;
          break;
        }
      }
    } catch {}
  }

  return { userRequest, claudeResponse };
}

function buildPrompt({
  userRequest,
  claudeResponse,
  planContent,
  transcriptPath,
  reviewSchema,
}) {
  return `<task>
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

${buildReviewInstructions(reviewSchema)}`;
}

function exitAllow(message) {
  if (message) {
    log(message);
  }
  process.exit(0);
}

const input = readHookInput();
log(`input received: ${JSON.stringify(input).slice(0, 1000)}`);

const transcriptPath = input.transcript_path;
if (!transcriptPath || !fs.existsSync(transcriptPath)) {
  exitAllow("no transcript path or file missing, allowing");
}

const toolInput = input.tool_input || {};
const planFile = toolInput.planFilePath;
const planContent = toolInput.plan;

if (!planFile || !planContent?.trim()) {
  exitAllow(`no plan in tool_input (planFilePath=${planFile ?? "missing"}), allowing`);
}

log(`plan file: ${planFile} (${planContent.length} chars)`);

const sessionId = input.session_id;
if (!sessionId) {
  exitAllow("no session_id, allowing");
}

const stateFile = stateFileFor(sessionId, planFile);
log(`state file path: ${stateFile}`);
const previousAttempts = readReviewAttempts(stateFile);

if (previousAttempts >= MAX_PLAN_REVIEWS) {
  const message = `Plan review already requested ${MAX_PLAN_REVIEWS} revisions for this plan; allowing user review.`;
  log(message);
  clearReviewAttempts(stateFile);
  process.stdout.write(JSON.stringify({ systemMessage: message }));
  process.exit(0);
}

log(`plan review attempt: ${previousAttempts + 1}/${MAX_PLAN_REVIEWS}`);

const reviewSchema = loadReviewSchema(REVIEW_SCHEMA_PATH);
if (!reviewSchema) {
  exitAllow(`failed to load review schema from ${REVIEW_SCHEMA_PATH}, allowing`);
}

const { userRequest, claudeResponse } =
  readLatestTranscriptContext(transcriptPath);
const prompt = buildPrompt({
  userRequest,
  claudeResponse,
  planContent,
  transcriptPath,
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
  codexTempPrefix: "exitplan-codex",
});

const validReviews = reviewerResults.filter(({ review }) => review);
if (validReviews.length === 0) {
  log(
    `${reviewerResults
      .map(
        ({ reviewer, reason }) =>
          `${reviewer}: ${reason || "invalid review output"}`,
      )
      .join("; ")}, allowing`,
  );
  process.exit(0);
}

const revisionComments = mergeReviewComments(validReviews);
if (revisionComments.length === 0) {
  log("verdict: approve, proceeding to user approval");
  clearReviewAttempts(stateFile);
  process.exit(0);
}

const feedback =
  revisionComments.length > 0
    ? revisionComments.map((comment, index) => `${index + 1}. ${comment}`).join("\n")
    : "No specific comments provided.";
log(`verdict: revise (${revisionComments.length} comments)`);
if (!writeReviewAttempts(stateFile, sessionId, planFile, previousAttempts + 1)) {
  const message =
    "Plan review requested revision, but retry state could not be persisted; allowing user review to avoid an unbounded retry loop.";
  process.stdout.write(JSON.stringify({ systemMessage: message }));
  process.exit(0);
}

process.stderr.write(
  `Plan review comments on the plan:\n\n${feedback}\n\nAddress the review comments above, update the plan file, then retry ExitPlanMode.`,
);
process.exit(2);
