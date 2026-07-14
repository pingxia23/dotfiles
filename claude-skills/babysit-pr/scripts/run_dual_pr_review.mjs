#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TAG = "[dual-pr-review]";
const LOG_FILE = path.join(SCRIPT_DIR, "run-dual-pr-review.log");
const REVIEW_DIR = path.join(SCRIPT_DIR, "reviews");
export const DEFAULT_REVIEW_TIMEOUT_MS = 15 * 60 * 1000;
export const CLAUDE_REVIEW_MODEL = "claude-opus-4-6[1m]";
export const CLAUDE_REVIEW_EFFORT = "xhigh";
export const CODEX_REVIEW_MODEL = "gpt-5.5";
export const CODEX_REVIEW_EFFORT = "high";

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
    repo: null,
    prNumber: null,
    prUrl: null,
    baseRef: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];

    if (arg === "--worktree-root") {
      args.worktreeRoot = value;
      index += 1;
    } else if (arg === "--repo") {
      args.repo = value;
      index += 1;
    } else if (arg === "--pr-number") {
      args.prNumber = value;
      index += 1;
    } else if (arg === "--pr-url") {
      args.prUrl = value;
      index += 1;
    } else if (arg === "--base-ref") {
      args.baseRef = value;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (!args.worktreeRoot) {
    throw new Error("--worktree-root is required");
  }
  if (!args.repo) {
    throw new Error("--repo is required");
  }
  if (!args.prNumber) {
    throw new Error("--pr-number is required");
  }
  if (!args.prUrl) {
    throw new Error("--pr-url is required");
  }
  if (!args.baseRef) {
    throw new Error("--base-ref is required");
  }

  return args;
}

function spawnWithTimeout(command, args, options = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const timeoutMs = options.timeout || DEFAULT_REVIEW_TIMEOUT_MS;
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
    }, timeoutMs);
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
          ? new Error(`timed out after ${timeoutMs}ms`)
          : null,
      });
    });
  });
}

function runSync(command, args, options = {}) {
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

function assertZero(result, label) {
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

function sanitizeFilePart(value) {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function buildReviewFile({ repo, prNumber }) {
  fs.mkdirSync(REVIEW_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const repoPart = sanitizeFilePart(repo.replace("/", "-"));
  return path.join(
    REVIEW_DIR,
    `${timestamp}-${repoPart}-pr-${prNumber}-${process.pid}.log`,
  );
}

function summarizeRun(label, result) {
  if (result.error) {
    return {
      reviewer: label,
      status: "error",
      error: result.error.message,
      stdout: getText(result.stdout),
      stderr: getText(result.stderr),
    };
  }
  if (result.status !== 0) {
    return {
      reviewer: label,
      status: "error",
      error: `exit ${result.status}`,
      stdout: getText(result.stdout),
      stderr: getText(result.stderr),
    };
  }

  return {
    reviewer: label,
    status: "revise",
    stdout: getText(result.stdout),
    stderr: getText(result.stderr),
  };
}

function classifyReviewText(reviewText) {
  const normalized = reviewText.toLowerCase();
  const approvedPatterns = [
    "no findings",
    "no issues found",
    "no issues were found",
    "no actionable findings",
    "no actionable issues",
  ];

  return approvedPatterns.some((pattern) => normalized.includes(pattern))
    ? "approved"
    : "revise";
}

async function runCodexReview({ worktreeRoot, reviewBase }) {
  const codexReviewFile = path.join(
    fs.mkdtempSync(path.join("/tmp", "babysit-pr-codex-review-")),
    "codex-review.md",
  );

  log(
    `running codex review base=${reviewBase} model=${CODEX_REVIEW_MODEL} effort=${CODEX_REVIEW_EFFORT} service_tier=fast output=${codexReviewFile}`,
  );
  const result = await spawnWithTimeout(
    "codex",
    [
      "exec",
      "review",
      "--model",
      CODEX_REVIEW_MODEL,
      "-c",
      `model_reasoning_effort="${CODEX_REVIEW_EFFORT}"`,
      "-c",
      'service_tier="fast"',
      "--base",
      reviewBase,
      "-o",
      codexReviewFile,
    ],
    { cwd: worktreeRoot },
  );
  log(
    `codex review exit=${result.status ?? "null"} signal=${
      result.signal ?? "null"
    } stdout_chars=${getText(result.stdout).length} stderr_chars=${
      getText(result.stderr).length
    }`,
  );
  if (getText(result.stdout)) {
    log(`codex review stdout:\n${getText(result.stdout)}`);
  }
  if (getText(result.stderr)) {
    log(`codex review stderr:\n${getText(result.stderr)}`);
  }

  const summary = summarizeRun("Codex", result);
  if (summary.status !== "error") {
    try {
      summary.review = fs.readFileSync(codexReviewFile, "utf8").trim();
      summary.status = classifyReviewText(summary.review);
    } catch (error) {
      summary.status = "error";
      summary.error = `failed to read codex review output: ${error.message}`;
    }
  }

  try {
    fs.rmSync(path.dirname(codexReviewFile), { recursive: true, force: true });
  } catch {}

  if (summary.review) {
    log(`codex review result:\n${summary.review}`);
  }
  return summary;
}

async function runClaudeReview({ worktreeRoot, prUrl }) {
  log(
    `running claude review pr=${prUrl} model=${CLAUDE_REVIEW_MODEL} effort=${CLAUDE_REVIEW_EFFORT}`,
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
      `/review ${prUrl}`,
    ],
    { cwd: worktreeRoot },
  );
  log(
    `claude review exit=${result.status ?? "null"} signal=${
      result.signal ?? "null"
    } stdout_chars=${getText(result.stdout).length} stderr_chars=${
      getText(result.stderr).length
    }`,
  );
  if (getText(result.stdout)) {
    log(`claude review stdout:\n${getText(result.stdout)}`);
  }
  if (getText(result.stderr)) {
    log(`claude review stderr:\n${getText(result.stderr)}`);
  }

  const summary = summarizeRun("Claude", result);
  if (summary.status !== "error") {
    summary.review = summary.stdout;
    summary.status = classifyReviewText(summary.review);
    log(`claude review result:\n${summary.review}`);
  }
  return summary;
}

function renderReviewerSection(result) {
  if (result.status === "error") {
    return [
      `## ${result.reviewer}`,
      "",
      `Status: ${result.status}`,
      "",
      result.error ? `Error: ${result.error}` : null,
      result.stdout ? ["### Stdout", "", result.stdout].join("\n") : null,
      result.stderr ? ["### Stderr", "", result.stderr].join("\n") : null,
      "",
    ]
      .filter((part) => part !== null)
      .join("\n");
  }

  return [
    `## ${result.reviewer}`,
    "",
    `Status: ${result.status}`,
    "",
    result.review || "_No review text._",
    "",
  ].join("\n");
}

function writeAggregatedReview({
  reviewFile,
  prUrl,
  baseRef,
  reviewBase,
  codexResult,
  claudeResult,
}) {
  const body = [
    "# PR Review",
    "",
    `PR: ${prUrl}`,
    `Target base ref: ${baseRef}`,
    `Review base: ${reviewBase}`,
    `Generated at: ${new Date().toISOString()}`,
    "",
    renderReviewerSection(codexResult),
    renderReviewerSection(claudeResult),
  ].join("\n");

  fs.writeFileSync(reviewFile, body);
  log(`aggregated review written to ${reviewFile}`);
  return body;
}

function upsertReviewSummaryComment({ prUrl, reviewFile }) {
  const scriptPath = path.join(SCRIPT_DIR, "upsert_review_summary_comment.mjs");
  const result = runSync(
    process.execPath,
    [scriptPath, "--pr-url", prUrl, "--review-file", reviewFile],
    { timeout: 120_000 },
  );

  if (result.error) {
    return {
      status: "error",
      error: result.error.message,
    };
  }
  if (result.status !== 0) {
    return {
      status: "error",
      error: getText(result.stderr) || getText(result.stdout) || `exit ${result.status}`,
    };
  }

  try {
    return {
      status: "ok",
      ...JSON.parse(result.stdout),
    };
  } catch {
    return {
      status: "error",
      error: "Unable to parse review summary upsert output",
    };
  }
}

async function runDualPrReview({
  worktreeRoot,
  repo,
  prNumber,
  prUrl,
  baseRef,
}) {
  log(
    `start worktree_root=${worktreeRoot} repo=${repo} pr_number=${prNumber} base_ref=${baseRef}`,
  );

  const authResult = runSync("codex", ["login", "status"], {
    cwd: worktreeRoot,
    timeout: 15_000,
  });
  assertZero(authResult, "codex auth check");

  const fetchResult = runSync("git", ["fetch", "origin", baseRef], {
    cwd: worktreeRoot,
    timeout: 120_000,
  });
  assertZero(fetchResult, "git fetch base branch");

  const headResult = runSync(
    "gh",
    [
      "pr",
      "view",
      "--repo",
      repo,
      prNumber,
      "--json",
      "headRefOid",
      "--jq",
      ".headRefOid",
    ],
    { cwd: worktreeRoot },
  );
  assertZero(headResult, "load PR head SHA");

  const localHeadResult = runSync("git", ["rev-parse", "HEAD"], {
    cwd: worktreeRoot,
  });
  assertZero(localHeadResult, "load local HEAD SHA");

  const remoteHead = getText(headResult.stdout);
  const localHead = getText(localHeadResult.stdout);
  if (localHead !== remoteHead) {
    throw new Error(
      `local checkout no longer matches PR head before review: local=${localHead} remote=${remoteHead}`,
    );
  }

  const mergeBaseResult = runSync(
    "git",
    ["merge-base", "HEAD", `origin/${baseRef}`],
    { cwd: worktreeRoot },
  );
  assertZero(mergeBaseResult, "compute PR review base commit");
  const reviewBase = getText(mergeBaseResult.stdout);
  log(`review_base=${reviewBase} base_ref=${baseRef}`);

  log("reviewers launched: Codex, Claude");
  const [codexResult, claudeResult] = await Promise.all([
    runCodexReview({ worktreeRoot, reviewBase }),
    runClaudeReview({ worktreeRoot, prUrl }),
  ]);

  const reviewFile = buildReviewFile({ repo, prNumber });
  writeAggregatedReview({
    reviewFile,
    prUrl,
    baseRef,
    reviewBase,
    codexResult,
    claudeResult,
  });

  const reviewerStatuses = {
    Codex: codexResult.status,
    Claude: claudeResult.status,
  };
  const status = Object.values(reviewerStatuses).includes("error")
    ? "error"
    : Object.values(reviewerStatuses).includes("revise")
      ? "revise"
      : "approved";
  log(`aggregate status=${status}`);

  const result = {
    status,
    pr_url: prUrl,
    base_ref: baseRef,
    review_base: reviewBase,
    review_file: reviewFile,
    reviewers: reviewerStatuses,
  };

  const errors = [];
  if (status === "error") {
    errors.push(
      ...[codexResult, claudeResult]
        .filter((reviewerResult) => reviewerResult.status === "error")
        .map((reviewerResult) => `${reviewerResult.reviewer}: ${reviewerResult.error}`),
    );
  }
  if (errors.length > 0) {
    result.error = errors.join("; ");
  }

  return result;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await runDualPrReview(args);
    const reviewComment = upsertReviewSummaryComment({
      prUrl: result.pr_url,
      reviewFile: result.review_file,
    });
    result.review_comment = reviewComment;
    if (reviewComment.status === "error") {
      result.error = [result.error, `Review comment: ${reviewComment.error}`]
        .filter(Boolean)
        .join("; ");
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    log(`error: ${error.message}`);
    process.stdout.write(
      `${JSON.stringify(
        {
          status: "error",
          error: error.message,
          reviewers: {
            Codex: "error",
            Claude: "error",
          },
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
