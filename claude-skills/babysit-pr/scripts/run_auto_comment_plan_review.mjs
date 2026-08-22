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
const LOG_FILE = path.join(
  os.tmpdir(),
  "babysit-pr-auto-comment-plan-review.log",
);

function parseArgs(argv) {
  const args = { worktreeRoot: "", prUrl: "" };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];

    if (arg === "--worktree-root") {
      args.worktreeRoot = value ?? "";
      index += 1;
    } else if (arg === "--pr-url") {
      args.prUrl = value ?? "";
      index += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (!args.worktreeRoot) {
    throw new Error("--worktree-root is required");
  }
  if (!args.prUrl) {
    throw new Error("--pr-url is required");
  }

  return args;
}

export function buildPrompt({ prUrl, plan, reviewSchema }) {
  return `<task>
Review this automatic PR comment address plan before implementation.

PR: ${prUrl}

<comment_address_plan>
${plan}
</comment_address_plan>

Verify that the plan:
- covers every supplied unresolved review comment
- correctly classifies each item as reply_only or implementation_needed
- gives a concrete, scoped implementation plan for every implementation_needed item
- does not turn clarification-only feedback into unnecessary code changes

The babysit-pr workflow will discard reply_only sections without replying and will send only
implementation_needed sections to code-implement-loop.
</task>

${buildReviewInstructions(reviewSchema)}`;
}

export function summarizeReviewerResults(reviewerResults) {
  const validReviews = reviewerResults.filter(({ review }) => review);
  const reviewers = Object.fromEntries(
    reviewerResults.map(({ reviewer, review }) => [
      reviewer,
      review ? (review.verdict === "approve" ? "approved" : "revise") : "unavailable",
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
        ? "The comment address plan needs revision."
        : "All valid reviewers approved the comment address plan.",
    reviewers,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const plan = fs.readFileSync(0, "utf8").trim();
  if (!plan) {
    throw new Error("comment address plan is required on stdin");
  }

  const reviewSchema = loadReviewSchema(REVIEW_SCHEMA_PATH);
  if (!reviewSchema) {
    throw new Error(`failed to load review schema: ${REVIEW_SCHEMA_PATH}`);
  }

  const log = createLogger({
    tag: "[auto-comment-plan-review]",
    logFile: LOG_FILE,
  });
  const prompt = buildPrompt({
    prUrl: args.prUrl,
    plan,
    reviewSchema,
  });
  const reviewerResults = await runPlanReviewers({
    prompt,
    cwd: args.worktreeRoot,
    reviewSchema,
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
