#!/usr/bin/env node

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
} from "../../../scripts/plan-review/shared.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REVIEW_SCHEMA_PATH = path.resolve(
  SCRIPT_DIR,
  "../../../scripts/plan-review/plan-review-output.schema.json",
);
const LOG_FILE = path.join(os.tmpdir(), "adr-plan-review.log");

function parseArgs(argv) {
  const args = { worktreeRoot: "", adrPath: "" };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];

    if (arg === "--worktree-root") {
      args.worktreeRoot = value ?? "";
      index += 1;
    } else if (arg === "--adr-path") {
      args.adrPath = value ?? "";
      index += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (!args.worktreeRoot) {
    throw new Error("--worktree-root is required");
  }
  if (!args.adrPath) {
    throw new Error("--adr-path is required");
  }

  return args;
}

export function buildPrompt({ adrPath, adr }) {
  return `${buildReviewInstructions()}

<task>
Review this Architecture Decision Record (ADR) before it is presented to the user.

ADR path: ${adrPath}

<adr>
${adr}
</adr>

Verify that the ADR:
- proposes a technically sound design that is internally consistent
- grounds important claims in repository code or documentation
- marks unsupported claims and future behavior as assumptions
- explains the end-to-end flow and non-trivial component behavior
- keeps explicit agreements, scope boundaries, and accepted tradeoffs intact
- gives accurate rationale for each decision and its main rejected alternative
- lists concrete consequences and material risks

Use repository evidence to check the design. Report only concrete issues that could make the
design incorrect, incomplete, misleading, or unsafe to implement. Do not report wording,
formatting, naming, or other style preferences.
</task>`;
}

export function summarizeReviewerResults(reviewerResults) {
  const validReviews = reviewerResults.filter(({ review }) => review);
  const reviewers = Object.fromEntries(
    reviewerResults.map(({ reviewer, review }) => [
      reviewer,
      review
        ? review.verdict === "approve"
          ? "approved"
          : "revise"
        : "unavailable",
    ]),
  );

  if (validReviews.length === 0) {
    return {
      status: "blocked",
      comments: [],
      overall_explanation: reviewerResults
        .map(
          ({ reviewer, reason }) =>
            `${reviewer}: ${reason || "invalid review output"}`,
        )
        .join("; "),
      reviewers,
    };
  }

  const comments = mergeReviewComments(validReviews);
  return {
    status: comments.length > 0 ? "revise" : "approved",
    comments,
    overall_explanation:
      comments.length > 0
        ? "The ADR needs revision."
        : "All valid reviewers approved the ADR.",
    reviewers,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const worktreeRoot = path.resolve(args.worktreeRoot);
  const adrPath = path.resolve(worktreeRoot, args.adrPath);

  if (!fs.statSync(worktreeRoot).isDirectory()) {
    throw new Error(`worktree root is not a directory: ${worktreeRoot}`);
  }
  if (!fs.statSync(adrPath).isFile()) {
    throw new Error(`ADR path is not a file: ${adrPath}`);
  }
  if (!loadReviewSchema(REVIEW_SCHEMA_PATH)) {
    throw new Error(`failed to load review schema: ${REVIEW_SCHEMA_PATH}`);
  }

  const adr = fs.readFileSync(adrPath, "utf8").trim();
  if (!adr) {
    throw new Error(`ADR is empty: ${adrPath}`);
  }

  const log = createLogger({ tag: "[adr-plan-review]", logFile: LOG_FILE });
  const reviewerResults = await runPlanReviewers({
    prompt: buildPrompt({ adrPath, adr }),
    cwd: worktreeRoot,
    log,
  });

  process.stdout.write(
    `${JSON.stringify(summarizeReviewerResults(reviewerResults), null, 2)}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify(
        {
          status: "blocked",
          comments: [],
          overall_explanation: error.message,
          reviewers: {},
        },
        null,
        2,
      )}\n`,
    );
  }
}
