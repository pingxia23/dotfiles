#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import {
  DEFAULT_REVIEW_TIMEOUT_MS,
  renderCodeReviewPrompt,
  runReviewPrompt,
} from "./review_runner_utils.mjs";
import { CODE_REVIEWER_CONFIGS } from "../reviewer_config.mjs";

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

export function renderReviewerPrompt(args) {
  return renderCodeReviewPrompt({
    reviewScope: "the full current local uncommitted patch set",
    reviewContext: `- Worktree root: ${args.worktreeRoot}
- Comparison version: local \`HEAD\`
- Reviewed change: tracked and untracked local changes relative to \`HEAD\`

Resolved implementation plan for this run:
${args.implementationPlan}`,
    gatherInstructions: `1. \`cd "${args.worktreeRoot}"\`.
2. Build the diff relative to \`HEAD\`:
   - tracked changes: \`git diff --binary HEAD\`
   - untracked non-ignored files: \`git ls-files --others --exclude-standard | LC_ALL=C sort\`
   - for each untracked file that Git does not ignore, append a new-file diff with \`git diff --no-index --binary -- /dev/null "$path" || true\`
   - append these new-file diffs in stable sorted path order
   - keep the normal diff form with \`--- /dev/null\` and \`+++ b/<path>\`
   - do not replace these diffs with plain file contents
3. Build the changed-files list:
   - tracked paths from \`git diff --name-status HEAD\`
   - append each untracked non-ignored file as \`A<TAB><path>\` in the same stable sorted order
4. For each changed file, inspect its current contents.
   - truncate to the first 400 lines per file when reading context
   - for tracked deletions, treat the file as \`<deleted from working tree; no current file contents>\``,
  });
}

export async function runDualPatchReview({
  worktreeRoot,
  implementationPlan,
  timeout = DEFAULT_REVIEW_TIMEOUT_MS,
}) {
  const prompt = renderReviewerPrompt({
    worktreeRoot,
    implementationPlan,
  });
  return runReviewPrompt({
    worktreeRoot,
    prompt,
    timeout,
  });
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
          reviews: Object.fromEntries(
            CODE_REVIEWER_CONFIGS.map(({ reviewer }) => [reviewer, null]),
          ),
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
