import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TAG = "[review-runner-utils]";
const LOG_FILE = path.join(SCRIPT_DIR, "review-runner-utils.log");
export const REVIEW_OUTPUT_SCHEMA_PATH = path.join(
  SCRIPT_DIR,
  "review-output.schema.json",
);
export const DEFAULT_REVIEW_TIMEOUT_MS = 10 * 60 * 1000;
export const PI_REVIEW_ARGS = Object.freeze([
  "-p",
  "--provider",
  "ai-gw-baseten",
  "--model",
  "baseten/zai-org/GLM-5.2",
  "--thinking",
  "high",
  "--no-session",
  "--tools",
  "read,bash,grep,find,ls",
]);
export const CODEX_REVIEW_MODEL = "gpt-5.5";
export const CODEX_REVIEW_EFFORT = "high";

const REVIEWERS = [
  "Correctness_codex",
  "correctness_pi",
  "pythonQuality_codex",
];
const reviewLog = createLogger({ tag: TAG, logFile: LOG_FILE });

export function renderPythonQualityReviewPrompt({
  reviewScope,
  reviewContext,
  gatherInstructions,
}) {
  return `# Python Quality Reviewer Prompt

You are the Python quality specialist reviewing ${reviewScope}.

Review only Python files changed by this change. If no Python files changed, return no findings. The correctness reviewers cover general bugs; focus on concrete Python implementation-quality problems that the original author would likely fix once identified.

If more specific instructions appear elsewhere, follow those over this file.

## Review Context

${reviewContext}

## How To Gather Review Inputs

${gatherInstructions}

## Required Guidance

Read these files before reviewing and apply them to the changed Python code:

- \`$HOME/dotfiles/python-implementation-guide.md\`
- the \`# Implementation Discipline\` section of \`$HOME/dotfiles/claude-global.md\`
- repository-local reviewer or contributor guidance that applies to the changed files

## What Counts As A Finding

Report an issue only when all of these are true:

1. It was introduced by the reviewed change.
2. It is discrete and actionable.
3. It creates a concrete Python maintainability, readability, test-design, typing, import, dependency, error-handling, or module-structure problem.
4. The original author would likely fix it if notified.
5. It is supported by the changed code and surrounding repository patterns, not by an unstated preference.
6. Fixing it does not require a higher quality bar than the rest of the codebase.

Do not report formatting, minor wording, documentation-only concerns, speculative future extensibility, or personal style preferences. If no issue clearly meets the bar, return no findings.

## Required Review Lenses

Review every applicable changed Python file for:

- imports, dependency use, and unnecessary dependencies
- type annotations and data shapes at changed boundaries
- function and module cohesion, ownership, and placement
- avoidable abstractions, hidden mutation, and unnecessarily indirect data flow
- error handling and logging at boundaries that can actually fail
- misleading names that obscure a changed contract or behavior
- duplicated implementation, fixtures, mocks, or tests that create a concrete maintenance risk
- test behavior, parametrization, fixture scope, mock boundaries, and edge-case coverage
- consistency with established patterns in the surrounding Python package

## Finding Rules

- Findings must target a changed Python file and a line changed by the reviewed diff.
- Use one finding per distinct issue.
- Keep line ranges as short as possible and normally under 5-10 lines.
- Do not stop at the first valid finding.
- Put concrete support in \`evidence\`, including the inspected code, test, guide, or established repository pattern.
- Do not let \`evidence\` merely repeat the finding.

## Finding Importance And Priority

Return only Python quality issues that you judge important or meaningful enough for the author to address. Omit minor preferences, optional cleanups, and low-value suggestions.

Mark every returned finding as \`P2\` with \`priority: 2\`. Do not emit P0 or P1 findings.

## Comment Rules

Before drafting a finding, read the \`## Writing Style\` section from \`$HOME/dotfiles/claude-global.md\`.

For each finding:

1. Start the title with its priority tag, such as \`[P2] Consolidate duplicated fixtures\`.
2. Keep the body brief, factual, and specific about the concrete maintenance cost.
3. Keep the body to one paragraph.
4. Do not include praise, filler, or a generated fix.

## Self-Challenge Before Output

Before returning JSON:

- Drop speculative, pre-existing, intentional, preference-only, minor, or low-value concerns.
- Confirm the issue is specific to Python quality and is not merely a duplicate of a general correctness concern.
- Merge findings that describe the same root cause.
- Confirm each location is the best changed-line anchor.
- Confirm every retained finding uses \`priority: 2\` and a \`[P2]\` title.

## Output Format

Return strict JSON only. Do not include markdown fences or extra prose.

The JSON must match this schema exactly:

{
  "findings": [
    {
      "title": "<≤ 80 chars, starts with [P2]>",
      "body": "<one-paragraph Markdown explanation>",
      "evidence": "<specific inspected evidence>",
      "priority": 2,
      "code_location": {
        "absolute_file_path": "<absolute Python file path>",
        "line_range": {"start": <int>, "end": <int>}
      }
    }
  ],
  "overall_explanation": "<1-3 sentence explanation>"
}
`;
}

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
  let overallExplanation = review.overall_explanation;

  if (findings.length !== review.findings.length) {
    overallExplanation =
      findings.length > 0
        ? "P0-P2 findings were returned."
        : "No P0-P2 findings were returned.";
  }

  return {
    ...review,
    findings,
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

  if (!hasOnlyKeys(value, ["findings", "overall_explanation"])) {
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
        !Number.isInteger(finding.priority) ||
        finding.priority < 0 ||
        finding.priority > 2
      ) {
        errors.push(`${prefix}.priority must be an integer from 0 to 2`);
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

  return { review: normalizeReview(value), errors: [] };
}

export function parseCodexReviewOutput(output) {
  const parsed = parseJsonObject(output);
  if (!parsed) {
    return { review: null, errors: ["output is not a JSON object"] };
  }

  return parseReviewObject(parsed);
}

export function parsePiReviewOutput(output) {
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

export async function runPiReview({
  prompt,
  cwd,
  timeout = DEFAULT_REVIEW_TIMEOUT_MS,
}) {
  reviewLog(`running pi in cwd=${cwd} with GLM 5.2 high thinking`);
  const promptPath = path.join(
    os.tmpdir(),
    `pi-code-review-${randomUUID()}.md`,
  );
  let result;
  try {
    fs.writeFileSync(promptPath, prompt, "utf8");
    result = await spawnWithTimeout(
      "pi",
      [...PI_REVIEW_ARGS, `@${promptPath}`],
      { cwd, timeout },
    );
  } finally {
    fs.rmSync(promptPath, { force: true });
  }
  reviewLog(
    `pi exit=${result.status ?? "null"} signal=${
      result.signal ?? "null"
    } stderr_chars=${getText(result.stderr).length}`,
  );

  if (result.error) {
    return {
      review: null,
      reason: `pi spawn failed: ${result.error.message}`,
    };
  }
  if (result.status !== 0) {
    return {
      review: null,
      reason: `pi non-zero exit: ${result.status}${
        getText(result.stderr) ? `: ${getText(result.stderr)}` : ""
      }`,
    };
  }

  const output = (result.stdout || "").trim();
  reviewLog(`trimmed pi review output:\n${output}`);

  const parsed = parsePiReviewOutput(output);
  if (!parsed.review) {
    reviewLog(
      `invalid pi review stdout=${JSON.stringify(
        (result.stdout || "").slice(0, 500),
      )}`,
    );
    return {
      review: null,
      reason: `invalid pi review output: ${parsed.errors.join("; ")}`,
    };
  }

  return { review: parsed.review, reason: null };
}

export async function runCodexReview({
  prompt,
  cwd,
  reviewSchemaPath,
  outputLabel = "Codex",
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
    `code-implement-loop-${sanitizeFilePart(outputLabel)}-${randomUUID()}.json`,
  );
  reviewLog(
    `running codex in cwd=${cwd} model=${CODEX_REVIEW_MODEL} effort=${CODEX_REVIEW_EFFORT} service_tier=fast output=${tmpFile}`,
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
      'service_tier="fast"',
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
      `${reviewer} returned ${result.review.findings.length} finding(s)`,
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

  const ignoredNote =
    unavailable.length > 0
      ? ` Ignored unavailable reviewer(s): ${unavailable
          .map(({ reviewer }) => reviewer)
          .join(", ")}.`
      : "";

  if (findings.length > 0) {
    return {
      status: "revise",
      findings,
      reviews,
      unavailable,
      overall_explanation:
        `${findings.length} reviewer finding(s) require fixes.` + ignoredNote,
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
  pythonQualityPrompt,
  reviewSchemaPath = REVIEW_OUTPUT_SCHEMA_PATH,
  timeout = DEFAULT_REVIEW_TIMEOUT_MS,
  codexReviewRunner = runCodexReview,
  piReviewRunner = runPiReview,
}) {
  reviewLog(
    "reviewers launched: Correctness_codex, correctness_pi, pythonQuality_codex",
  );
  const piReview = runReviewerOnce({
    reviewer: "correctness_pi",
    prompt,
    runReview: (reviewPrompt) =>
      piReviewRunner({
        prompt: reviewPrompt,
        cwd: worktreeRoot,
        timeout,
      }),
  });
  const codexReview = runReviewerOnce({
    reviewer: "Correctness_codex",
    prompt,
    runReview: (reviewPrompt) =>
      codexReviewRunner({
        prompt: reviewPrompt,
        cwd: worktreeRoot,
        reviewSchemaPath,
        outputLabel: "Correctness_codex",
        timeout,
      }),
  });
  const pythonQualityReview = runReviewerOnce({
    reviewer: "pythonQuality_codex",
    prompt: pythonQualityPrompt,
    runReview: (reviewPrompt) =>
      codexReviewRunner({
        prompt: reviewPrompt,
        cwd: worktreeRoot,
        reviewSchemaPath,
        outputLabel: "pythonQuality_codex",
        timeout,
      }),
  });

  const results = await Promise.all([
    codexReview,
    piReview,
    pythonQualityReview,
  ]);
  const aggregate = aggregateReviews(results);
  reviewLog(`aggregate status=${aggregate.status}`);
  return aggregate;
}
