#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import {
  DEFAULT_REVIEW_TIMEOUT_MS,
  renderCorrectnessReviewPrompt,
  renderPythonQualityReviewPrompt,
  runDualReviewPrompt,
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
  return renderCorrectnessReviewPrompt({
    reviewScope: "the full current local uncommitted patch set",
    reviewContext: `- Worktree root: ${args.worktreeRoot}
- Diff baseline: local \`HEAD\`
- Reviewed change: tracked and untracked local changes relative to \`HEAD\`

Resolved implementation plan for this run:
${args.implementationPlan}`,
    gatherInstructions: `1. \`cd "${args.worktreeRoot}"\`.
2. Build the patch set relative to \`HEAD\`:
   - tracked changes: \`git diff --binary HEAD\`
   - untracked non-ignored files: \`git ls-files --others --exclude-standard | LC_ALL=C sort\`
   - for each untracked non-ignored file, append a synthetic new-file patch via \`git diff --no-index --binary -- /dev/null "$path" || true\`
   - append untracked-file patches in stable sorted path order
   - keep them in normal patch form with \`--- /dev/null\` and \`+++ b/<path>\`
   - do not replace untracked-file patches with raw file blobs
3. Build the changed-files list:
   - tracked paths from \`git diff --name-status HEAD\`
   - append each untracked non-ignored file as \`A<TAB><path>\` in the same stable sorted order
4. For each changed path, inspect the current working-tree contents.
   - truncate to the first 400 lines per file when reading context
   - for tracked deletions, treat the file as \`<deleted from working tree; no current file contents>\``,
  });
}

function renderPythonQualityPrompt(args) {
  return renderPythonQualityReviewPrompt({
    reviewScope: "the full current local uncommitted patch set",
    reviewContext: `- Worktree root: ${args.worktreeRoot}
- Resolved implementation plan for this run: ${args.implementationPlan}`,
    gatherInstructions: `1. \`cd "${args.worktreeRoot}"\`.
2. Build the patch set relative to \`HEAD\`:
   - tracked changes: \`git diff --binary HEAD\`
   - untracked non-ignored files: \`git ls-files --others --exclude-standard | LC_ALL=C sort\`
   - for each untracked file, append a synthetic patch with \`git diff --no-index --binary -- /dev/null "$path" || true\`
3. Build the changed-files list from \`git diff --name-status HEAD\` plus the sorted untracked files.
4. If the changed-files list contains no \`.py\` files, return no findings immediately.
5. Inspect the current contents and surrounding package patterns for every changed Python file.
6. Compare the Python changes with the implementation plan, but report only quality issues introduced by the patch.`,
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
  const pythonQualityPrompt = renderPythonQualityPrompt({
    worktreeRoot,
    implementationPlan,
  });

  return runDualReviewPrompt({
    worktreeRoot,
    prompt,
    pythonQualityPrompt,
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
