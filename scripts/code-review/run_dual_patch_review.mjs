#!/usr/bin/env node
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_REVIEW_TIMEOUT_MS,
  REVIEW_OUTPUT_SCHEMA_PATH,
  renderPythonQualityReviewPrompt,
  runDualReviewPrompt,
} from "./review_runner_utils.mjs";

const REVIEWER_PROMPT_TEMPLATE = `# Reviewer Prompt

You are reviewing a proposed code change made by another engineer.

Your job is to find bugs in the current local uncommitted patch set. Return only issues that the original author would likely want to fix once they know about them.

If more specific instructions appear elsewhere, follow those over this file.

## What Counts As A Bug

Flag an issue only when all of these are true:

1. It meaningfully affects correctness, performance, security, or maintainability.
2. It is discrete and actionable.
3. Fixing it does not require a higher rigor bar than the rest of the codebase.
4. It was introduced by the current patch set.
5. The original author would likely fix it if notified.
6. It does not depend on unstated assumptions about intent.
7. You can identify the concrete code path or scenario that is affected.
8. It is not obviously an intentional product or design choice.

If no issue clearly meets that bar, return no findings.

## Review Scope

- Review the full current local uncommitted patch set only.
- Re-review the full local uncommitted patch set each time the review loop runs.
- Do not narrow review scope to only previously flagged hunks.
- Compare the patch set against the implementation plan.
- Focus on correctness, regressions, security, compatibility, performance, and tests.
- Do not block on pure style, formatting, typos, documentation, or other nits.

## Implementation Discipline Checks

Read the \`# Implementation Discipline\` section from  \`$HOME/dotfiles/claude-global.md\`. 

Review the change against these disciplines. For any obvious violation introduced by the change, flag a P2 finding.

## How To Gather Review Inputs

Inputs provided directly:
- Worktree root: {worktree_root}
- Resolved implementation plan for this run: {implementation_plan}


Before reviewing, gather the local uncommitted patch set yourself:

1. \`cd "{worktree_root}"\`.
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
   - for tracked deletions, treat the file as \`<deleted from working tree; no current file contents>\`

## Required Internal Scout Pass

Before producing findings, build a short internal scout summary from the implementation plan and the local patch set. Do not output the scout summary.

The scout summary must cover:

- intended change and expected behavior
- changed surface area and likely blast radius
- relevant tool, framework, language, config, schema, API, auth, or data-flow context
- implementation-plan-vs-patch consistency
- pre-existing or out-of-scope issues that should not be reported

Use the scout summary to guide review. If the patch differs semantically from the implementation plan, flag that mismatch only when it creates a P0-P2 correctness, compatibility, security, performance, or maintainability bug.

## Required Review Lenses

Review the patch through every lens that applies to the changed files:

- functional correctness and regressions
- structure, contracts, and cross-module coupling
- language-specific issues, especially Python typing/import/test patterns when Python files change
- tests, fixtures, mocks, generated files, and build metadata
- config, schema, API, auth, security, tenant, operational, retry, or observability behavior when touched

## Finding Rules

- Findings may target tracked-file hunks or appended synthetic new-file hunks for untracked files.
- \`code_location\` must overlap the relevant diff hunk.
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
5. Put mandatory supporting detail in \`evidence\`: exact file/function/line/config/test/external source actually inspected, plus any necessary inference.
6. Do not let \`evidence\` merely restate the finding.
7. Do not include code snippets longer than 3 lines.
8. Use \`suggestion\` blocks only for concrete replacement code.
9. In any \`suggestion\` block, preserve exact leading whitespace.
10. Do not add or remove outer indentation unless that is the actual fix.
11. Avoid unnecessary file or location chatter in the prose; the inline location already provides context.
12. Do not generate a PR fix unless a minimal \`suggestion\` block is genuinely needed.

## Priority Scale

- \`P0\` / \`priority: 0\`: release-blocking or universally severe issue
- \`P1\` / \`priority: 1\`: urgent issue that should be fixed in the next cycle
- \`P2\` / \`priority: 2\`: normal bug to fix eventually

If priority is unclear or lower than P2, omit the finding.

### Examples Of Lower-Severity Concerns To Omit

Only P0, P1, and P2 bugs count as findings. Do not return lower-severity
concerns at all.

Do not report examples like these:

- "This should be more defensive" is not a finding when the existing callers,
  types, schema, or surrounding code already guarantee the value is valid.
- "This could break with malformed input" is not a finding when that input
  cannot reach this code path without bypassing an existing parser, validator,
  authorization check, or documented caller contract.
- "This message/name/comment/log could be clearer" is not a finding when the
  issue does not change runtime behavior.
- "This could be simpler/faster/more idiomatic" is not a finding unless the
  patch introduced a measurable regression or a concrete maintainability bug.
- "This should add validation/fallback/cleanup/telemetry/compatibility handling"
  is not a finding unless the implementation plan or existing surrounding
  patterns require it.

These concerns must not appear in \`findings\`.

## Self-Challenge Before Output

Before returning JSON, challenge every candidate finding:

- Keep it only if the evidence proves the issue is introduced by the current patch set.
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
      "body": "<valid Markdown explaining *why* this is a problem; cite files/lines/functions>",
      "evidence": "<specific code/config/test/source evidence supporting the finding>",
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
- The \`code_location\` range must overlap the diff, including appended synthetic new-file hunks for untracked files.
- Do not wrap the JSON in markdown fences or extra prose.
- The code_location field is required and must include absolute_file_path and line_range.
- Line ranges must be as short as possible for interpreting the issue (avoid ranges over 5-10 lines; pick the most suitable subrange).
- The code_location should overlap with the diff.
- Do not generate a PR fix.
`;

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

function renderReviewerPrompt(args) {
  const replacements = {
    "{worktree_root}": args.worktreeRoot,
    "{implementation_plan}": args.implementationPlan,
  };
  const pattern = /\{worktree_root\}|\{implementation_plan\}/g;

  return REVIEWER_PROMPT_TEMPLATE.replace(
    pattern,
    (match) => replacements[match],
  );
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
  reviewSchemaPath = REVIEW_OUTPUT_SCHEMA_PATH,
  reviewSchema = fs.readFileSync(reviewSchemaPath, "utf8").trim(),
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
    reviewSchemaPath,
    reviewSchema,
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
          reviews: {
            Correctness_codex: null,
            correctness_pi: null,
            pythonQuality_codex: null,
          },
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
