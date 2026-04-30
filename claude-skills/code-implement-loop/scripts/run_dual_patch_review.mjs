#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { renderReviewerPrompt } from "./render_reviewer_prompt.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TAG = "[dual-patch-review]";
const LOG_FILE = path.join(SCRIPT_DIR, "run-dual-patch-review.log");
export const PATCH_REVIEW_SCHEMA_PATH = path.join(
  SCRIPT_DIR,
  "patch-review-output.schema.json",
);
export const DEFAULT_REVIEW_TIMEOUT_MS = 15 * 60 * 1000;
export const CLAUDE_REVIEW_MODEL = "claude-opus-4-7[1m]";
export const CLAUDE_REVIEW_EFFORT = "xhigh";
export const CODEX_REVIEW_MODEL = "gpt-5.5";
export const CODEX_REVIEW_EFFORT = "high";
export const CODEX_SERVICE_TIER = "fast";

const REVIEWERS = ["Codex", "Claude"];
const SCHEMA_REMINDER =
  "\n\nSchema reminder: return exactly one JSON object matching the supplied patch-review schema. Do not include markdown fences or prose outside the JSON object.";

function getText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function log(message) {
  const line = `${new Date().toISOString()} ${TAG} ${message}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch {}
}

function parseArgs(argv) {
  const args = {
    worktreeRoot: null,
    implementationPlan: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];

    if (arg === "--worktree-root") {
      args.worktreeRoot = value;
      index += 1;
    } else if (arg === "--implementation-plan") {
      args.implementationPlan = value;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (!args.worktreeRoot) {
    throw new Error("--worktree-root is required");
  }
  if (args.implementationPlan === null) {
    throw new Error("--implementation-plan is required");
  }

  return args;
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

function hasOnlyKeys(value, allowedKeys) {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

export function validatePatchReview(value) {
  const errors = [];

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, errors: ["review must be an object"] };
  }

  if (
    !hasOnlyKeys(value, [
      "findings",
      "overall_correctness",
      "overall_explanation",
      "overall_confidence_score",
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
          "confidence_score",
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
        typeof finding.confidence_score !== "number" ||
        finding.confidence_score < 0 ||
        finding.confidence_score > 1
      ) {
        errors.push(`${prefix}.confidence_score must be a number from 0 to 1`);
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
    errors.push("overall_correctness must be a valid patch verdict");
  }
  if (
    typeof value.overall_explanation !== "string" ||
    value.overall_explanation.length === 0
  ) {
    errors.push("overall_explanation must be a non-empty string");
  }
  if (
    typeof value.overall_confidence_score !== "number" ||
    value.overall_confidence_score < 0 ||
    value.overall_confidence_score > 1
  ) {
    errors.push("overall_confidence_score must be a number from 0 to 1");
  }

  return { valid: errors.length === 0, errors };
}

function parsePatchReviewObject(value) {
  const validation = validatePatchReview(value);
  if (!validation.valid) {
    return { review: null, errors: validation.errors };
  }

  return { review: value, errors: [] };
}

export function parseCodexPatchReviewOutput(output) {
  const parsed = parseJsonObject(output);
  if (!parsed) {
    return { review: null, errors: ["output is not a JSON object"] };
  }

  return parsePatchReviewObject(parsed);
}

export function parseClaudePatchReviewOutput(output) {
  const parsed = parseJsonObject(output);
  if (!parsed) {
    return { review: null, errors: ["output is not a JSON object"] };
  }

  const direct = parsePatchReviewObject(parsed);
  if (direct.review) {
    return direct;
  }

  if (
    parsed.structured_output &&
    typeof parsed.structured_output === "object" &&
    !Array.isArray(parsed.structured_output)
  ) {
    const structured = parsePatchReviewObject(parsed.structured_output);
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

function spawnWithTimeout(command, args, options = {}) {
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

async function runClaudeReview({
  prompt,
  cwd,
  reviewSchema,
  timeout = DEFAULT_REVIEW_TIMEOUT_MS,
}) {
  log(
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
  log(
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
  log(`trimmed claude review output:\n${output}`);

  const parsed = parseClaudePatchReviewOutput(output);
  if (!parsed.review) {
    log(
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

async function runCodexReview({
  prompt,
  cwd,
  reviewSchemaPath,
  timeout = DEFAULT_REVIEW_TIMEOUT_MS,
}) {
  log(`checking codex auth in cwd=${cwd}`);
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
  log(
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
  log(
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

  log(`trimmed codex review output:\n${output}`);

  const parsed = parseCodexPatchReviewOutput(output);
  if (!parsed.review) {
    log(`invalid codex review stdout=${JSON.stringify(output.slice(0, 500))}`);
    return {
      review: null,
      reason: `invalid codex review output: ${parsed.errors.join("; ")}`,
    };
  }

  return { review: parsed.review, reason: null };
}

export async function runReviewerWithRetries({
  reviewer,
  runReview,
  prompt,
}) {
  let result = await runReview(prompt);

  if (!result.review) {
    log(
      `${reviewer} review attempt 1 unavailable: ${
        result.reason || "invalid review output"
      }`,
    );
    log(`${reviewer} review attempt 2 launched with schema reminder`);
    result = await runReview(`${prompt}${SCHEMA_REMINDER}`);
  }

  if (
    result.review &&
    result.review.findings.length === 0 &&
    result.review.overall_correctness === "incorrect"
  ) {
    log(`${reviewer} review consistency retry launched`);
    const rerun = await runReview(`${prompt}${SCHEMA_REMINDER}`);
    if (
      !rerun.review ||
      (rerun.review.findings.length === 0 &&
        rerun.review.overall_correctness === "incorrect")
    ) {
      return {
        reviewer,
        review: null,
        reason:
          "inconsistent review: empty findings with incorrect patch verdict",
      };
    }
    result = rerun;
  }

  if (result.review) {
    log(
      `${reviewer} verdict: ${result.review.overall_correctness} (${result.review.findings.length} findings)`,
    );
  } else {
    log(`${reviewer} review unavailable: ${result.reason || "invalid review output"}`);
  }

  return { reviewer, ...result };
}

export function aggregatePatchReviews(results) {
  const reviews = {};
  const unavailable = [];

  for (const reviewer of REVIEWERS) {
    const result = results.find((candidate) => candidate.reviewer === reviewer);
    if (!result || !result.review) {
      unavailable.push({
        reviewer,
        reason: result?.reason || "review unavailable",
      });
      reviews[reviewer] = null;
    } else {
      reviews[reviewer] = result.review;
    }
  }

  if (unavailable.length > 0) {
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
  for (const reviewer of REVIEWERS) {
    const review = reviews[reviewer];
    review.findings.forEach((finding, sourceIndex) => {
      findings.push({
        reviewer,
        source_index: sourceIndex,
        ...finding,
      });
    });
  }

  const incorrectReviewers = REVIEWERS.filter(
    (reviewer) => reviews[reviewer].overall_correctness === "incorrect",
  );

  if (findings.length > 0 || incorrectReviewers.length > 0) {
    return {
      status: "revise",
      findings,
      reviews,
      unavailable: [],
      overall_explanation:
        findings.length > 0
          ? `${findings.length} reviewer finding(s) require fixes.`
          : `${incorrectReviewers.join(", ")} returned an incorrect patch verdict.`,
    };
  }

  return {
    status: "approved",
    findings: [],
    reviews,
    unavailable: [],
    overall_explanation: "Both reviewers approved the patch.",
  };
}

export async function runDualPatchReview({
  worktreeRoot,
  implementationPlan,
  reviewSchemaPath = PATCH_REVIEW_SCHEMA_PATH,
  reviewSchema = fs.readFileSync(reviewSchemaPath, "utf8").trim(),
  timeout = DEFAULT_REVIEW_TIMEOUT_MS,
}) {
  log(`worktree_root=${worktreeRoot}`);
  const prompt = renderReviewerPrompt({
    worktreeRoot,
    implementationPlan,
  });

  log("reviewers launched: Codex, Claude");
  const claudeReview = runReviewerWithRetries({
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
  const codexReview = runReviewerWithRetries({
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
  const aggregate = aggregatePatchReviews(results);
  log(`aggregate status=${aggregate.status}`);
  return aggregate;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await runDualPatchReview({
      worktreeRoot: args.worktreeRoot,
      implementationPlan: args.implementationPlan,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify(
        {
          status: "blocked",
          findings: [],
          reviews: { Codex: null, Claude: null },
          unavailable: [{ reviewer: "runner", reason: error.message }],
          overall_explanation: error.message,
        },
        null,
        2,
      )}\n`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
