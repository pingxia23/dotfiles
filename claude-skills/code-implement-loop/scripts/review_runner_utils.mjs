import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TAG = "[review-runner-utils]";
const LOG_FILE = path.join(SCRIPT_DIR, "review-runner-utils.log");
export const REVIEW_OUTPUT_SCHEMA_PATH = path.join(
  SCRIPT_DIR,
  "review-output.schema.json",
);
export const DEFAULT_REVIEW_TIMEOUT_MS = 15 * 60 * 1000;
export const CLAUDE_REVIEW_MODEL = "sonnet[1m]";
export const CLAUDE_REVIEW_EFFORT = "high";
export const CODEX_REVIEW_MODEL = "gpt-5.6-sol";
export const CODEX_REVIEW_EFFORT = "high";
export const CODEX_SERVICE_TIER = "fast";

const REVIEWERS = ["Codex", "Claude"];
const reviewLog = createLogger({ tag: TAG, logFile: LOG_FILE });

export function getText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function createLogger({ tag, logFile }) {
  return function log(message) {
    const line = `${new Date().toISOString()} ${tag} ${message}\n`;
    try {
      fs.appendFileSync(logFile, line);
    } catch {}
  };
}

export function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
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
      resolve({ stdout, stderr, ...result });
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

export function runSync(command, args, options = {}) {
  const log = options.log || (() => {});
  log(`running ${command} ${args.join(" ")} cwd=${options.cwd}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    timeout: options.timeout || 60_000,
  });
  log(
    `${command} exit=${result.status ?? "null"} signal=${
      result.signal ?? "null"
    } stdout_chars=${getText(result.stdout).length} stderr_chars=${
      getText(result.stderr).length
    }`,
  );
  if (getText(result.stdout)) {
    log(`${command} stdout:\n${getText(result.stdout)}`);
  }
  if (getText(result.stderr)) {
    log(`${command} stderr:\n${getText(result.stderr)}`);
  }
  return result;
}

export function assertZero(result, label) {
  if (result.error) {
    throw new Error(`${label} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `${label} failed with exit ${result.status}: ${
        getText(result.stderr) || getText(result.stdout) || "no output"
      }`,
    );
  }
}

export function sanitizeFilePart(value) {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function hasOnlyKeys(value, allowedKeys) {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isActionablePriority(priority) {
  return Number.isInteger(priority) && priority >= 0 && priority <= 2;
}

export function normalizeReview(review) {
  const findings = review.findings.filter((finding) =>
    isActionablePriority(finding.priority),
  );
  const overallCorrectness = findings.length > 0 ? "incorrect" : "correct";
  let overallExplanation = review.overall_explanation;

  if (overallCorrectness !== review.overall_correctness) {
    overallExplanation =
      findings.length > 0
        ? "P0-P2 findings were returned."
        : "No P0-P2 findings were returned.";
  }

  return {
    ...review,
    findings,
    overall_correctness: overallCorrectness,
    overall_explanation: overallExplanation,
  };
}

function normalizeReviewResult(result) {
  return result.review
    ? { ...result, review: normalizeReview(result.review) }
    : result;
}

export function validateReviewOutput(value) {
  const errors = [];

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, errors: ["review must be an object"] };
  }

  if (
    !hasOnlyKeys(value, [
      "findings",
      "overall_correctness",
      "overall_explanation",
    ])
  ) {
    errors.push("review contains additional properties");
  }

  if (!Array.isArray(value.findings)) {
    errors.push("findings must be an array");
  } else {
    value.findings.forEach((finding, index) => {
      const prefix = `findings[${index}]`;
      if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
        errors.push(`${prefix} must be an object`);
        return;
      }
      if (
        !hasOnlyKeys(finding, [
          "title",
          "body",
          "evidence",
          "priority",
          "code_location",
        ])
      ) {
        errors.push(`${prefix} contains additional properties`);
      }
      if (typeof finding.title !== "string" || finding.title.length === 0) {
        errors.push(`${prefix}.title must be a non-empty string`);
      } else if (finding.title.length > 80) {
        errors.push(`${prefix}.title must be at most 80 characters`);
      }
      if (typeof finding.body !== "string" || finding.body.length === 0) {
        errors.push(`${prefix}.body must be a non-empty string`);
      }
      if (
        typeof finding.evidence !== "string" ||
        finding.evidence.length === 0
      ) {
        errors.push(`${prefix}.evidence must be a non-empty string`);
      }
      if (!("priority" in finding)) {
        errors.push(`${prefix}.priority is required`);
      } else if (
        finding.priority !== null &&
        (!Number.isInteger(finding.priority) ||
          finding.priority < 0 ||
          finding.priority > 3)
      ) {
        errors.push(`${prefix}.priority must be an integer from 0 to 3 or null`);
      }

      const location = finding.code_location;
      if (!location || typeof location !== "object" || Array.isArray(location)) {
        errors.push(`${prefix}.code_location must be an object`);
        return;
      }
      if (!hasOnlyKeys(location, ["absolute_file_path", "line_range"])) {
        errors.push(`${prefix}.code_location contains additional properties`);
      }
      if (
        typeof location.absolute_file_path !== "string" ||
        location.absolute_file_path.length === 0
      ) {
        errors.push(
          `${prefix}.code_location.absolute_file_path must be a non-empty string`,
        );
      }

      const lineRange = location.line_range;
      if (!lineRange || typeof lineRange !== "object" || Array.isArray(lineRange)) {
        errors.push(`${prefix}.code_location.line_range must be an object`);
        return;
      }
      if (!hasOnlyKeys(lineRange, ["start", "end"])) {
        errors.push(`${prefix}.code_location.line_range contains additional properties`);
      }
      if (!Number.isInteger(lineRange.start) || lineRange.start < 1) {
        errors.push(`${prefix}.code_location.line_range.start must be an integer >= 1`);
      }
      if (!Number.isInteger(lineRange.end) || lineRange.end < 1) {
        errors.push(`${prefix}.code_location.line_range.end must be an integer >= 1`);
      } else if (
        Number.isInteger(lineRange.start) &&
        lineRange.start >= 1 &&
        lineRange.end < lineRange.start
      ) {
        errors.push(
          `${prefix}.code_location.line_range.end must be >= line_range.start`,
        );
      }
    });
  }

  if (!["correct", "incorrect"].includes(value.overall_correctness)) {
    errors.push("overall_correctness must be a valid review verdict");
  }
  if (
    typeof value.overall_explanation !== "string" ||
    value.overall_explanation.length === 0
  ) {
    errors.push("overall_explanation must be a non-empty string");
  }

  return { valid: errors.length === 0, errors };
}

function parseReviewObject(value) {
  const validation = validateReviewOutput(value);
  if (!validation.valid) {
    return { review: null, errors: validation.errors };
  }

  // Nonsensical output: the reviewer claims the change is incorrect but lists
  // no actionable finding. Treat it as invalid so the caller retries once and
  // then ignores this reviewer rather than trusting a contentless verdict.
  const actionableFindings = value.findings.filter((finding) =>
    isActionablePriority(finding.priority),
  );
  if (
    actionableFindings.length === 0 &&
    value.overall_correctness === "incorrect"
  ) {
    return {
      review: null,
      errors: ["incorrect verdict with no actionable findings"],
    };
  }

  return { review: normalizeReview(value), errors: [] };
}

export function parseCodexReviewOutput(output) {
  const parsed = parseJsonObject(output);
  if (!parsed) {
    return { review: null, errors: ["output is not a JSON object"] };
  }

  return parseReviewObject(parsed);
}

export function parseClaudeReviewOutput(output) {
  const parsed = parseJsonObject(output);
  if (!parsed) {
    return { review: null, errors: ["output is not a JSON object"] };
  }

  const direct = parseReviewObject(parsed);
  if (direct.review) {
    return direct;
  }

  if (
    parsed.structured_output &&
    typeof parsed.structured_output === "object" &&
    !Array.isArray(parsed.structured_output)
  ) {
    const structured = parseReviewObject(parsed.structured_output);
    if (structured.review) {
      return structured;
    }

    return {
      review: null,
      errors: structured.errors.map((error) => `structured_output.${error}`),
    };
  }

  return { review: null, errors: direct.errors };
}

export async function runClaudeReview({
  prompt,
  cwd,
  reviewSchema,
  timeout = DEFAULT_REVIEW_TIMEOUT_MS,
}) {
  reviewLog(
    `running claude in cwd=${cwd} model=${CLAUDE_REVIEW_MODEL} effort=${CLAUDE_REVIEW_EFFORT}`,
  );
  const result = await spawnWithTimeout(
    "claude",
    [
      "-p",
      "--model",
      CLAUDE_REVIEW_MODEL,
      "--effort",
      CLAUDE_REVIEW_EFFORT,
      "--no-session-persistence",
      "--allowedTools",
      "Read,Bash,Glob,Grep",
      "--output-format",
      "json",
      "--json-schema",
      reviewSchema,
      prompt,
    ],
    { cwd, timeout },
  );
  reviewLog(
    `claude exit=${result.status ?? "null"} signal=${
      result.signal ?? "null"
    } stderr_chars=${getText(result.stderr).length}`,
  );

  if (result.error) {
    return {
      review: null,
      reason: `claude spawn failed: ${result.error.message}`,
    };
  }
  if (result.status !== 0) {
    return {
      review: null,
      reason: `claude non-zero exit: ${result.status}${
        getText(result.stderr) ? `: ${getText(result.stderr)}` : ""
      }`,
    };
  }

  const output = (result.stdout || "").trim();
  reviewLog(`trimmed claude review output:\n${output}`);

  const parsed = parseClaudeReviewOutput(output);
  if (!parsed.review) {
    reviewLog(
      `invalid claude review stdout=${JSON.stringify(
        (result.stdout || "").slice(0, 500),
      )}`,
    );
    return {
      review: null,
      reason: `invalid claude review output: ${parsed.errors.join("; ")}`,
    };
  }

  return { review: parsed.review, reason: null };
}

export async function runCodexReview({
  prompt,
  cwd,
  reviewSchemaPath,
  timeout = DEFAULT_REVIEW_TIMEOUT_MS,
}) {
  reviewLog(`checking codex auth in cwd=${cwd}`);
  const authResult = spawnSync("codex", ["login", "status"], {
    cwd,
    encoding: "utf8",
    timeout: 15_000,
  });

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
    `code-implement-loop-codex-review-${Date.now()}-${process.pid}.json`,
  );
  reviewLog(
    `running codex in cwd=${cwd} model=${CODEX_REVIEW_MODEL} effort=${CODEX_REVIEW_EFFORT} service_tier=${CODEX_SERVICE_TIER} output=${tmpFile}`,
  );
  const result = await spawnWithTimeout(
    "codex",
    [
      "exec",
      "--model",
      CODEX_REVIEW_MODEL,
      "-c",
      `model_reasoning_effort="${CODEX_REVIEW_EFFORT}"`,
      "-c",
      `service_tier="${CODEX_SERVICE_TIER}"`,
      "--sandbox",
      "read-only",
      "--ephemeral",
      "--output-schema",
      reviewSchemaPath,
      "-o",
      tmpFile,
      prompt,
    ],
    { cwd, timeout },
  );
  reviewLog(
    `codex exit=${result.status ?? "null"} signal=${
      result.signal ?? "null"
    } stderr_chars=${getText(result.stderr).length}`,
  );

  if (result.error) {
    try {
      fs.unlinkSync(tmpFile);
    } catch {}
    return {
      review: null,
      reason: `codex spawn failed: ${result.error.message}`,
    };
  }
  if (result.status !== 0) {
    try {
      fs.unlinkSync(tmpFile);
    } catch {}
    return {
      review: null,
      reason: `codex non-zero exit: ${result.status}${
        getText(result.stderr) ? `: ${getText(result.stderr)}` : ""
      }`,
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

  reviewLog(`trimmed codex review output:\n${output}`);

  const parsed = parseCodexReviewOutput(output);
  if (!parsed.review) {
    reviewLog(`invalid codex review stdout=${JSON.stringify(output.slice(0, 500))}`);
    return {
      review: null,
      reason: `invalid codex review output: ${parsed.errors.join("; ")}`,
    };
  }

  return { review: parsed.review, reason: null };
}

export async function runReviewerOnce({
  reviewer,
  runReview,
  prompt,
}) {
  const result = normalizeReviewResult(await runReview(prompt));

  if (result.review) {
    reviewLog(
      `${reviewer} verdict: ${result.review.overall_correctness} (${result.review.findings.length} findings)`,
    );
  } else {
    reviewLog(`${reviewer} review unavailable: ${result.reason || "invalid review output"}`);
  }

  return { reviewer, ...result };
}

export function aggregateReviews(results) {
  const reviews = {};
  const unavailable = [];
  const availableReviewers = [];

  for (const reviewer of REVIEWERS) {
    const result = results.find((candidate) => candidate.reviewer === reviewer);
    if (!result || !result.review) {
      unavailable.push({
        reviewer,
        reason: result?.reason || "review unavailable",
      });
      reviews[reviewer] = null;
    } else {
      reviews[reviewer] = normalizeReview(result.review);
      availableReviewers.push(reviewer);
    }
  }

  // Ignore unavailable reviewers and proceed on whoever produced a usable
  // review. Only block when no reviewer is usable at all.
  if (availableReviewers.length === 0) {
    return {
      status: "blocked",
      findings: [],
      reviews,
      unavailable,
      overall_explanation: unavailable
        .map(({ reviewer, reason }) => `${reviewer}: ${reason}`)
        .join("; "),
    };
  }

  const findings = [];
  for (const reviewer of availableReviewers) {
    const review = reviews[reviewer];
    review.findings.forEach((finding, sourceIndex) => {
      findings.push({
        reviewer,
        source_index: sourceIndex,
        ...finding,
      });
    });
  }

  const incorrectReviewers = availableReviewers.filter(
    (reviewer) => reviews[reviewer].overall_correctness === "incorrect",
  );
  const ignoredNote =
    unavailable.length > 0
      ? ` Ignored unavailable reviewer(s): ${unavailable
          .map(({ reviewer }) => reviewer)
          .join(", ")}.`
      : "";

  if (findings.length > 0 || incorrectReviewers.length > 0) {
    return {
      status: "revise",
      findings,
      reviews,
      unavailable,
      overall_explanation:
        (findings.length > 0
          ? `${findings.length} reviewer finding(s) require fixes.`
          : `${incorrectReviewers.join(", ")} returned an incorrect review verdict.`) +
        ignoredNote,
    };
  }

  return {
    status: "approved",
    findings: [],
    reviews,
    unavailable,
    overall_explanation: `${availableReviewers.join(
      ", ",
    )} approved the change.${ignoredNote}`,
  };
}

export async function runDualReviewPrompt({
  worktreeRoot,
  prompt,
  reviewSchemaPath = REVIEW_OUTPUT_SCHEMA_PATH,
  reviewSchema = fs.readFileSync(reviewSchemaPath, "utf8").trim(),
  timeout = DEFAULT_REVIEW_TIMEOUT_MS,
}) {
  reviewLog("reviewers launched: Codex, Claude");
  const claudeReview = runReviewerOnce({
    reviewer: "Claude",
    prompt,
    runReview: (reviewPrompt) =>
      runClaudeReview({
        prompt: reviewPrompt,
        cwd: worktreeRoot,
        reviewSchema,
        timeout,
      }),
  });
  const codexReview = runReviewerOnce({
    reviewer: "Codex",
    prompt,
    runReview: (reviewPrompt) =>
      runCodexReview({
        prompt: reviewPrompt,
        cwd: worktreeRoot,
        reviewSchemaPath,
        timeout,
      }),
  });

  const results = await Promise.all([codexReview, claudeReview]);
  const aggregate = aggregateReviews(results);
  reviewLog(`aggregate status=${aggregate.status}`);
  return aggregate;
}
