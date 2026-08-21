import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const DEFAULT_REVIEW_TIMEOUT_MS = 5 * 60 * 1000;
export const PI_PLAN_REVIEW_EXTENSION_PATH = fileURLToPath(
  new URL("./pi_plan_review_output.mjs", import.meta.url),
);
export const PI_REVIEW_ARGS = Object.freeze([
  "--provider",
  "ai-gw-baseten",
  "--model",
  "baseten/zai-org/GLM-5.2",
  "--thinking",
  "high",
  "--mode",
  "json",
  "--extension",
  PI_PLAN_REVIEW_EXTENSION_PATH,
  "--tools",
  "read,bash,edit,write,grep,find,ls,mcp,submit_plan_review",
]);
export const CODEX_REVIEW_MODEL = "gpt-5.5";
export const CODEX_REVIEW_EFFORT = "high";
const PI_PLAN_REVIEW_SUBMISSION_INSTRUCTIONS = `## Pi Plan Review Submission

Your final action must be one submit_plan_review tool call.
Do not return the plan review as assistant text.
Do not call submit_plan_review with other tools in the same tool batch.`;

export function getText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function getPiSessionRoot() {
  if (process.env.PI_CODING_AGENT_SESSION_DIR) {
    return path.resolve(process.env.PI_CODING_AGENT_SESSION_DIR);
  }
  const agentDir = process.env.PI_CODING_AGENT_DIR
    ? path.resolve(process.env.PI_CODING_AGENT_DIR)
    : path.join(os.homedir(), ".pi", "agent");
  return path.join(agentDir, "sessions");
}

export function findPiSessionFile(sessionRoot, sessionId) {
  if (!fs.existsSync(sessionRoot)) {
    return null;
  }
  const pendingDirectories = [sessionRoot];
  const expectedSuffix = `_${sessionId}.jsonl`;

  while (pendingDirectories.length > 0) {
    const directory = pendingDirectories.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pendingDirectories.push(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(expectedSuffix)) {
        return entryPath;
      }
    }
  }
  return null;
}

export function createLogger({ tag, logFile, stderr = false }) {
  return (message) => {
    const line = `${new Date().toISOString()} ${tag} ${message}\n`;
    if (stderr) {
      process.stderr.write(line);
    }
    try {
      fs.appendFileSync(logFile, line);
    } catch {}
  };
}

export function loadReviewSchema(schemaPath) {
  try {
    return fs.readFileSync(schemaPath, "utf8").trim();
  } catch {
    return null;
  }
}

export function spawnWithTimeout(command, args, options = {}) {
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
    }, options.timeout || DEFAULT_REVIEW_TIMEOUT_MS);
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

export function isReviewObject(value) {
  return (
    value &&
    typeof value === "object" &&
    ["approve", "revise"].includes(value.verdict) &&
    Array.isArray(value.comments)
  );
}

function hasOnlyKeys(value, allowedKeys) {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

export function validatePlanReviewOutput(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, errors: ["plan review must be an object"] };
  }
  if (!hasOnlyKeys(value, ["verdict", "comments"])) {
    errors.push("plan review contains additional properties");
  }
  if (!["approve", "revise"].includes(value.verdict)) {
    errors.push('verdict must be "approve" or "revise"');
  }
  if (!Array.isArray(value.comments)) {
    errors.push("comments must be an array");
  } else {
    value.comments.forEach((comment, index) => {
      if (typeof comment !== "string") {
        errors.push(`comments[${index}] must be a string`);
      }
    });
  }
  return { valid: errors.length === 0, errors };
}

export function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function parsePiReviewOutput(output) {
  const events = [];
  for (const [index, rawLine] of output.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    try {
      const event = JSON.parse(line);
      if (!event || typeof event !== "object" || Array.isArray(event)) {
        return {
          review: null,
          errors: [`Pi output line ${index + 1} is not a JSON object`],
        };
      }
      events.push(event);
    } catch {
      return {
        review: null,
        errors: [`Pi output line ${index + 1} is not valid JSON`],
      };
    }
  }

  const submissions = events.filter(
    (event) =>
      event.type === "tool_execution_end" &&
      event.toolName === "submit_plan_review",
  );
  if (submissions.length === 0) {
    return {
      review: null,
      errors: ["missing submit_plan_review tool result"],
    };
  }
  if (submissions.length !== 1) {
    return {
      review: null,
      errors: [
        `expected one submit_plan_review tool result, found ${submissions.length}`,
      ],
    };
  }

  const submission = submissions[0];
  if (submission.isError !== false) {
    return {
      review: null,
      errors: ["submit_plan_review tool call failed"],
    };
  }

  const submissionIndex = events.indexOf(submission);
  const finalAssistantMessageIndex = events.findLastIndex(
    (event, index) =>
      index < submissionIndex &&
      event.type === "message_end" &&
      event.message?.role === "assistant",
  );
  if (finalAssistantMessageIndex !== -1) {
    const companionTool = events
      .slice(finalAssistantMessageIndex + 1, submissionIndex + 1)
      .find(
        (event) =>
          typeof event.type === "string" &&
          event.type.startsWith("tool_execution_") &&
          event.toolName !== "submit_plan_review",
      );
    if (companionTool) {
      return {
        review: null,
        errors: [
          `submit_plan_review shared its final tool batch with ${companionTool.toolName}`,
        ],
      };
    }
  }

  const laterAction = events.slice(submissionIndex + 1).some((event) => {
    if (
      (typeof event.type === "string" &&
        event.type.startsWith("tool_execution_")) ||
      event.type === "message_update" ||
      event.type === "turn_start"
    ) {
      return true;
    }
    return (
      (event.type === "message_start" || event.type === "message_end") &&
      event.message?.role === "assistant"
    );
  });
  if (laterAction) {
    return {
      review: null,
      errors: ["submit_plan_review was not the final Pi action"],
    };
  }

  const review = submission.result?.details;
  const validation = validatePlanReviewOutput(review);
  if (!validation.valid) {
    return {
      review: null,
      errors: validation.errors.map(
        (error) => `submit_plan_review.${error}`,
      ),
    };
  }

  return { review, errors: [] };
}

export function parseCodexReviewOutput(output) {
  const parsed = parseJsonObject(output);
  return isReviewObject(parsed) ? parsed : null;
}

export async function reviewPlanWithPi({
  prompt,
  cwd,
  log,
  timeout = DEFAULT_REVIEW_TIMEOUT_MS,
}) {
  const sessionId = randomUUID();
  const sessionRoot = getPiSessionRoot();
  log(
    `pi_session_started ${JSON.stringify({ session_id: sessionId, session_root: sessionRoot, cwd })}`,
  );
  log(`running pi in cwd=${cwd} with GLM 5.2 high thinking`);
  const promptDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pi-plan-review-"),
  );
  const promptPath = path.join(promptDirectory, "prompt.md");
  let piResult;
  try {
    fs.writeFileSync(
      promptPath,
      `${prompt}\n\n${PI_PLAN_REVIEW_SUBMISSION_INSTRUCTIONS}\n`,
      "utf8",
    );
    piResult = await spawnWithTimeout(
      "pi",
      [...PI_REVIEW_ARGS, "--session-id", sessionId, `@${promptPath}`],
      { cwd, timeout },
    );
  } finally {
    fs.rmSync(promptDirectory, { force: true, recursive: true });
  }
  log(
    `pi exit=${piResult.status ?? "null"} signal=${
      piResult.signal ?? "null"
    } stderr_chars=${getText(piResult.stderr).length}`,
  );
  log(
    `pi_session_finished ${JSON.stringify({
      session_id: sessionId,
      session_file: findPiSessionFile(sessionRoot, sessionId),
      timed_out: piResult.error?.message.includes("timed out") ?? false,
      exit_status: piResult.status,
      signal: piResult.signal,
    })}`,
  );

  if (piResult.error) {
    return {
      review: null,
      reason: `pi spawn failed: ${piResult.error.message}`,
    };
  }

  if (piResult.status !== 0) {
    return {
      review: null,
      reason: `pi non-zero exit: ${piResult.status}`,
    };
  }

  const output = (piResult.stdout || "").trim();
  log(`pi plan-review event stream chars=${output.length}`);

  const parsed = parsePiReviewOutput(output);
  if (!parsed.review) {
    log(`invalid pi plan review output: ${parsed.errors.join("; ")}`);
    return {
      review: null,
      reason: `invalid pi plan review output: ${parsed.errors.join("; ")}`,
    };
  }

  return { review: parsed.review, reason: null };
}

export async function reviewPlanWithCodex({
  prompt,
  cwd,
  reviewSchemaPath,
  log,
  timeout = DEFAULT_REVIEW_TIMEOUT_MS,
  tempPrefix = "plan-review-codex",
}) {
  const authResult = spawnSync(
    "codex",
    ["-c", 'service_tier="fast"', "login", "status"],
    {
      cwd,
      encoding: "utf8",
      timeout: 15_000,
    },
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
      reason: `codex auth check failed: ${
        getText(authResult.stderr) || authResult.status
      }`,
    };
  }

  const tmpFile = path.join(
    os.tmpdir(),
    `${tempPrefix}-${Date.now()}-${process.pid}.json`,
  );

  log(
    `running codex in cwd=${cwd} model=${CODEX_REVIEW_MODEL} effort=${CODEX_REVIEW_EFFORT} service_tier=fast`,
  );
  const codexResult = await spawnWithTimeout(
    "codex",
    [
      "exec",
      "--model",
      CODEX_REVIEW_MODEL,
      "-c",
      `model_reasoning_effort="${CODEX_REVIEW_EFFORT}"`,
      "-c",
      'service_tier="fast"',
      "--output-schema",
      reviewSchemaPath,
      "-o",
      tmpFile,
      prompt,
    ],
    {
      cwd,
      timeout,
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

  const review = parseCodexReviewOutput(output);
  if (!review) {
    log(`invalid codex review stdout=${JSON.stringify(output.slice(0, 500))}`);
    return { review: null, reason: "invalid codex review output" };
  }

  return { review, reason: null };
}

export function runReviewer(reviewer, reviewPromise) {
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

export function mergeReviewComments(reviews) {
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

export async function runPlanReviewers({
  prompt,
  cwd,
  reviewSchemaPath,
  log,
  codexTempPrefix,
}) {
  const piReview = runReviewer(
    "Pi",
    reviewPlanWithPi({
      prompt,
      cwd,
      log,
    }),
  );
  const codexReview = runReviewer(
    "Codex",
    reviewPlanWithCodex({
      prompt,
      cwd,
      reviewSchemaPath,
      log,
      tempPrefix: codexTempPrefix,
    }),
  );
  const reviewerResults = await Promise.all([codexReview, piReview]);

  for (const { reviewer, review, reason } of reviewerResults) {
    if (review) {
      log(
        `${reviewer} verdict: ${review.verdict} (${review.comments.length} comments)`,
      );
    } else {
      log(`${reviewer} review unavailable: ${reason || "invalid review output"}`);
    }
  }

  return reviewerResults;
}

export function buildReviewInstructions(reviewSchema) {
  return `<review_policy>
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

<plan_pseudocode_rules>
  Treat code blocks and snippets in the plan as illustrative pseudocode unless the plan explicitly says they are exact code to copy.
  Review pseudocode for design clarity, behavioral correctness, data shape, edge cases, and integration points.
  Do not flag pseudocode for syntax, imports, exact API names, formatting, or compile correctness unless those details create ambiguity, imply incorrect behavior, or would likely mislead implementation.
</plan_pseudocode_rules>

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
