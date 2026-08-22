import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CODE_REVIEWER_CONFIGS,
  CODE_REVIEW_TIMEOUT_MS,
} from "../reviewer_config.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TAG = "[review-runner-utils]";
const LOG_FILE = path.join(SCRIPT_DIR, "review-runner-utils.log");
export const DEFAULT_REVIEW_TIMEOUT_MS = CODE_REVIEW_TIMEOUT_MS;

const REVIEWERS = CODE_REVIEWER_CONFIGS.map(({ reviewer }) => reviewer);
const PI_REVIEW_SUBMISSION_INSTRUCTIONS = `## Pi Review Submission

Your final action must be one submit_review tool call.
Do not return the review as assistant text.
Do not call submit_review with other tools in the same tool batch.`;
const reviewLog = createLogger({ tag: TAG, logFile: LOG_FILE });

export function renderCorrectnessReviewPrompt({
  reviewScope,
  reviewContext,
  gatherInstructions,
}) {
  return `# Correctness Reviewer Prompt

You are the correctness specialist reviewing ${reviewScope}.

Your job is to find bugs introduced by the reviewed change. Return only issues that the original author would likely want to fix once they know about them.

If more specific instructions appear elsewhere, follow those over this file.

## What Counts As A Bug

Flag an issue only when all of these are true:

1. It meaningfully affects correctness, performance, security, or maintainability.
2. It is discrete and actionable.
3. Fixing it does not require a higher rigor bar than the rest of the codebase.
4. It was introduced by the reviewed change relative to the baseline described below.
5. The original author would likely fix it if notified.
6. It does not depend on unstated assumptions about intent.
7. You can identify the concrete code path or scenario that is affected.
8. It is not obviously an intentional product or design choice.

It is not enough to speculate that the change may disrupt another part of the codebase. Identify the other code path, caller, state transition, or runtime scenario that is concretely affected.

If no issue clearly meets that bar, return no findings.

## Review Scope

- Review the full change described below each time the review runs.
- Do not narrow review scope to only previously flagged hunks.
- Compare the change against the provided author-intent sources.
- Focus on correctness, regressions, security, compatibility, performance, and tests.
- Do not block on pure style, formatting, typos, documentation, or other nits.
- Do not include P3, nit, or freeform suggestions in findings.

## Review Context

${reviewContext}

## Implementation Discipline Checks

Read the \`# Implementation Discipline\` section from \`$HOME/dotfiles/claude-global.md\`.

Review the change against these disciplines. For any obvious violation introduced by the change, flag a P2 finding.

## How To Gather Review Inputs

${gatherInstructions}

## Required Internal Scout Pass

Before producing findings, build a short internal scout summary from the author-intent sources and review inputs described above. Do not output the scout summary.

The scout summary must cover:

- intended change and expected behavior
- changed surface area and likely blast radius
- relevant tool, framework, language, config, schema, API, auth, data-flow, or domain context
- author-intent-vs-diff consistency
- pre-existing or out-of-scope issues that should not be reported

Use the scout summary to guide review. Explicitly compare the available author-intent sources and the actual diff. Flag semantic mismatches only when they create a P0-P2 bug, such as hidden public API changes, removed flags, unannounced behavior changes, broken downstream consumer contracts, or missing rollout or test coverage for a changed contract.

## Required Review Lenses

Review the change through every lens that applies to the changed files:

- functional correctness and regressions
- structure, contracts, and cross-module coupling
- language-specific issues, especially Python typing, import, and test patterns when Python files change
- tests, fixtures, mocks, generated files, and build metadata
- config, schema, API, auth, security, tenant, operational, retry, or observability behavior when touched

## Finding Rules

- Findings must target lines in files changed by the reviewed diff, including synthetic new-file hunks for untracked files.
- \`code_location\` must overlap the relevant diff hunk when possible.
- Use one finding per distinct issue.
- Keep ranges as short as possible. Avoid ranges longer than 5-10 lines.
- Do not stop at the first valid finding. Return all valid findings.

## Comment Rules

Before drafting any finding title, body, evidence, or suggestion, read the \`## Writing Style\` section from \`$HOME/dotfiles/claude-global.md\` and apply it without changing the prescribed JSON structure.

For each finding:

1. Make the title start with a priority tag, for example \`[P1] Wrong cache key for tenant lookup\`.
2. Make the body brief, factual, and specific about why this is a bug.
3. Explain the scenario, input, or environment required for the bug to happen when relevant.
4. Keep the body to one paragraph.
5. Put mandatory supporting detail in \`evidence\`: exact file, function, line, config, test, or external source actually inspected, plus any necessary inference.
6. Do not let \`evidence\` merely restate the finding.
7. Do not include code snippets longer than 3 lines.
8. Use \`suggestion\` blocks only for concrete replacement code.
9. In any \`suggestion\` block, preserve exact leading whitespace.
10. Do not add or remove outer indentation unless that is the actual fix.
11. Avoid unnecessary file or location chatter in the prose; the inline location already provides context.
12. Do not overstate severity; make the required scenario, environment, or input immediately clear when severity depends on it.
13. Use a matter-of-fact, non-accusatory tone. Do not include praise or human-style review filler.
14. Do not generate a PR fix unless a minimal \`suggestion\` block is genuinely needed.

## Priority Scale

- \`P0\` / \`priority: 0\`: release-blocking or universally severe issue that does not depend on assumptions about inputs or environment
- \`P1\` / \`priority: 1\`: urgent issue that should be fixed in the next cycle
- \`P2\` / \`priority: 2\`: normal bug to fix eventually

If priority is unclear or lower than P2, omit the finding.

### Examples Of Lower-Severity Concerns To Omit

Only P0, P1, and P2 bugs count as findings. Do not return lower-severity concerns at all.

Do not report examples like these:

- "This should be more defensive" is not a finding when the existing callers, types, schema, or surrounding code already guarantee the value is valid.
- "This could break with malformed input" is not a finding when that input cannot reach this code path without bypassing an existing parser, validator, authorization check, or documented caller contract.
- "This message, name, comment, or log could be clearer" is not a finding when the issue does not change runtime behavior.
- "This could be simpler, faster, or more idiomatic" is not a finding unless the change introduced a measurable regression or a concrete maintainability bug.
- "This should add validation, fallback, cleanup, telemetry, or compatibility handling" is not a finding unless the author-intent sources or existing surrounding patterns require it.

These concerns must not appear in \`findings\`.

## Self-Challenge Before Output

Before returning JSON, challenge every candidate finding:

- Keep it only if the evidence proves the issue is introduced by the reviewed change relative to its baseline.
- Drop it if it is speculative, pre-existing, intentional, sub-P2, or based on a missing unstated requirement.
- Merge duplicates that describe the same root cause.
- Demote severity when the scenario is narrower than first assumed.
- Confirm the changed-line anchor is the best available location for the bug.

## Output Format

Return strict JSON only. Do not include markdown fences or extra prose.

The JSON must match this schema exactly:

{
  "findings": [
    {
      "title": "<≤ 80 chars, imperative>",
      "body": "<valid Markdown explaining why this is a problem>",
      "evidence": "<specific code, config, test, or source evidence supporting the finding>",
      "priority": <int 0-2>,
      "code_location": {
        "absolute_file_path": "<file path>",
        "line_range": {"start": <int>, "end": <int>}
      }
    }
  ],
  "overall_explanation": "<1-3 sentence explanation of the findings or why none remain>"
}

Additional output rules:

- \`code_location.absolute_file_path\` is required.
- \`code_location.line_range.start\` and \`code_location.line_range.end\` are required.
- \`evidence\` is required for every finding and must describe the concrete source you inspected, not just repeat the body.
- The \`code_location\` range should overlap the diff.
- Do not wrap the JSON in markdown fences or extra prose.
- Do not generate a PR fix.
`;
}

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

export function createLogger({ tag, logFile }) {
  return function log(message) {
    const line = `${new Date().toISOString()} ${tag} ${message}\n`;
    try {
      fs.appendFileSync(logFile, line);
    } catch {}
  };
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
      event.toolName === "submit_review",
  );
  if (submissions.length === 0) {
    return {
      review: null,
      errors: ["missing submit_review tool result"],
    };
  }
  if (submissions.length !== 1) {
    return {
      review: null,
      errors: [
        `expected one submit_review tool result, found ${submissions.length}`,
      ],
    };
  }

  const submission = submissions[0];
  if (submission.isError !== false) {
    return {
      review: null,
      errors: ["submit_review tool call failed"],
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
          event.toolName !== "submit_review",
      );
    if (companionTool) {
      return {
        review: null,
        errors: [
          `submit_review shared its final tool batch with ${companionTool.toolName}`,
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
      errors: ["submit_review was not the final Pi action"],
    };
  }

  const parsed = parseReviewObject(submission.result?.details);
  if (!parsed.review) {
    return {
      review: null,
      errors: parsed.errors.map((error) => `submit_review.${error}`),
    };
  }

  return parsed;
}

export async function runPiReview({
  prompt,
  cwd,
  reviewer,
  provider,
  model,
  thinking,
  serviceTier,
  mode,
  extensionPath,
  tools,
  timeout = DEFAULT_REVIEW_TIMEOUT_MS,
}) {
  const sessionId = randomUUID();
  const sessionRoot = getPiSessionRoot();
  reviewLog(
    `pi_session_started ${JSON.stringify({ session_id: sessionId, session_root: sessionRoot, cwd })}`,
  );
  reviewLog(
    `running pi reviewer=${reviewer} cwd=${cwd} provider=${provider} model=${model} thinking=${thinking} service_tier=${serviceTier || "default"}`,
  );
  const promptPath = path.join(
    os.tmpdir(),
    `pi-code-review-${sessionId}.md`,
  );
  let result;
  try {
    fs.writeFileSync(
      promptPath,
      `${prompt}\n\n${PI_REVIEW_SUBMISSION_INSTRUCTIONS}\n`,
      "utf8",
    );
    result = await spawnWithTimeout(
      "pi",
      [
        "--provider",
        provider,
        "--model",
        model,
        "--thinking",
        thinking,
        "--mode",
        mode,
        "--extension",
        extensionPath,
        "--tools",
        tools,
        "--session-id",
        sessionId,
        `@${promptPath}`,
      ],
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
  reviewLog(
    `pi_session_finished ${JSON.stringify({
      session_id: sessionId,
      session_file: findPiSessionFile(sessionRoot, sessionId),
      timed_out: result.error?.message.includes("timed out") ?? false,
      exit_status: result.status,
      signal: result.signal,
    })}`,
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
  reviewLog(`pi review event stream chars=${output.length}`);

  const parsed = parsePiReviewOutput(output);
  if (!parsed.review) {
    reviewLog(`invalid pi review output: ${parsed.errors.join("; ")}`);
    return {
      review: null,
      reason: `invalid pi review output: ${parsed.errors.join("; ")}`,
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
  timeout = DEFAULT_REVIEW_TIMEOUT_MS,
  piReviewRunner = runPiReview,
}) {
  reviewLog(
    `reviewers launched: ${REVIEWERS.join(", ")}`,
  );
  const reviews = CODE_REVIEWER_CONFIGS.map((config) =>
    runReviewerOnce({
      reviewer: config.reviewer,
      prompt:
        config.promptKind === "pythonQuality" ? pythonQualityPrompt : prompt,
      runReview: (reviewPrompt) =>
        piReviewRunner({
          ...config,
          prompt: reviewPrompt,
          cwd: worktreeRoot,
          timeout,
        }),
    }),
  );

  const results = await Promise.all(reviews);
  const aggregate = aggregateReviews(results);
  reviewLog(`aggregate status=${aggregate.status}`);
  return aggregate;
}
