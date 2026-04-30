import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

export const DEFAULT_REVIEW_TIMEOUT_MS = 10 * 60 * 1000;
export const CLAUDE_REVIEW_MODEL = "claude-opus-4-7[1m]";
export const CLAUDE_REVIEW_EFFORT = "xhigh";
export const CODEX_REVIEW_MODEL = "gpt-5.5";
export const CODEX_REVIEW_EFFORT = "high";

export function getText(value) {
  return typeof value === "string" ? value.trim() : "";
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

export function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function parseClaudeReviewOutput(output) {
  const parsed = parseJsonObject(output);
  if (!parsed) {
    return null;
  }

  if (isReviewObject(parsed)) {
    return parsed;
  }

  if (
    parsed.structured_output &&
    typeof parsed.structured_output === "object" &&
    isReviewObject(parsed.structured_output)
  ) {
    return parsed.structured_output;
  }

  return null;
}

export function parseCodexReviewOutput(output) {
  const parsed = parseJsonObject(output);
  return isReviewObject(parsed) ? parsed : null;
}

export async function reviewPlanWithClaude({
  prompt,
  cwd,
  reviewSchema,
  log,
  timeout = DEFAULT_REVIEW_TIMEOUT_MS,
}) {
  log(
    `running claude in cwd=${cwd} model=${CLAUDE_REVIEW_MODEL} effort=${CLAUDE_REVIEW_EFFORT}`,
  );
  const claudeResult = await spawnWithTimeout(
    "claude",
    [
      "-p",
      "--model",
      CLAUDE_REVIEW_MODEL,
      "--effort",
      CLAUDE_REVIEW_EFFORT,
      "--no-session-persistence",
      "--allowedTools",
      "Read,Write,Edit,Bash,Glob,Grep,WebFetch,WebSearch",
      "--output-format",
      "json",
      "--json-schema",
      reviewSchema,
      prompt,
    ],
    {
      cwd,
      timeout,
    },
  );
  log(
    `claude exit=${claudeResult.status ?? "null"} signal=${
      claudeResult.signal ?? "null"
    } stderr_chars=${getText(claudeResult.stderr).length}`,
  );

  if (claudeResult.error) {
    return {
      review: null,
      reason: `claude spawn failed: ${claudeResult.error.message}`,
    };
  }

  if (claudeResult.status !== 0) {
    return {
      review: null,
      reason: `claude non-zero exit: ${claudeResult.status}`,
    };
  }

  const output = (claudeResult.stdout || "").trim();
  log(`trimmed claude review output:\n${output}`);

  const review = parseClaudeReviewOutput(output);
  if (!review) {
    log(
      `invalid claude review stdout=${JSON.stringify(
        (claudeResult.stdout || "").slice(0, 500),
      )}`,
    );
    return { review: null, reason: "invalid claude review output" };
  }

  return { review, reason: null };
}

export async function reviewPlanWithCodex({
  prompt,
  cwd,
  reviewSchemaPath,
  log,
  timeout = DEFAULT_REVIEW_TIMEOUT_MS,
  tempPrefix = "plan-review-codex",
}) {
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
    `${tempPrefix}-${Date.now()}-${process.pid}.json`,
  );

  log(
    `running codex in cwd=${cwd} model=${CODEX_REVIEW_MODEL} effort=${CODEX_REVIEW_EFFORT}`,
  );
  const codexResult = await spawnWithTimeout(
    "codex",
    [
      "exec",
      "--model",
      CODEX_REVIEW_MODEL,
      "-c",
      `model_reasoning_effort="${CODEX_REVIEW_EFFORT}"`,
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
  reviewSchema,
  reviewSchemaPath,
  log,
  codexTempPrefix,
}) {
  const claudeReview = runReviewer(
    "Claude",
    reviewPlanWithClaude({
      prompt,
      cwd,
      reviewSchema,
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
  const reviewerResults = await Promise.all([codexReview, claudeReview]);

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
