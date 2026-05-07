#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_REVIEW_TIMEOUT_MS,
  REVIEW_OUTPUT_SCHEMA_PATH,
  assertZero,
  createLogger,
  getText,
  runDualReviewPrompt,
  runSync,
} from "./review_runner_utils.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TAG = "[dual-pr-branch-review]";
const LOG_FILE = path.join(SCRIPT_DIR, "run-dual-pr-branch-review.log");
const log = createLogger({ tag: TAG, logFile: LOG_FILE });

const PR_REVIEWER_PROMPT_TEMPLATE = `# Full Branch Reviewer Prompt

You are reviewing a full local branch change made by another engineer.

Your job is to find bugs in the exact local checkout: committed branch changes at {head_sha} plus current uncommitted changes, compared against the PR base commit {review_base}. Return only issues that the original author would likely want to fix once they know about them.

If more specific instructions appear elsewhere, follow those over this file.

## What Counts As A Bug

Flag an issue only when all of these are true:

1. It meaningfully affects correctness, performance, security, or maintainability.
2. It is discrete and actionable.
3. Fixing it does not require a higher rigor bar than the rest of the codebase.
4. It was introduced by the local branch or uncommitted changes relative to the review base.
5. The original author would likely fix it if notified.
6. It does not depend on unstated assumptions about intent.
7. You can identify the concrete code path or scenario that is affected.
8. It is not obviously an intentional product or design choice.

If no issue clearly meets that bar, return no findings.

## Review Scope

- Review the full local branch plus current uncommitted changes only.
- Compare the local checkout against review base \`{review_base}\`.
- Include committed branch changes, staged changes, unstaged tracked changes, and untracked non-ignored files.
- Focus on correctness, regressions, security, compatibility, performance, and tests.
- Do not block on pure style, formatting, typos, documentation, or other nits.
- Do not include P3/nit/freeform suggestions in findings.

## PR Context

- Worktree root: {worktree_root}
- Repository: {repo}
- PR: {pr_url}
- PR number: {pr_number}
- PR title: {pr_title}
- Target base ref: {base_ref}
- Review base commit: {review_base}
- Local head commit: {head_sha}
- Remote PR head commit: {remote_head_sha}
- Local branch: {head_ref}

Changed files:
{changed_files}

## How To Gather Review Inputs

Before reviewing, gather the exact full local patch yourself:

1. \`cd "{worktree_root}"\`.
2. Verify \`git rev-parse HEAD\` prints \`{head_sha}\`.
3. Build the tracked-file diff with \`git diff --binary {review_base}\`.
4. Build the changed-files list with \`git diff --name-status {review_base}\`.
5. For each changed path, inspect the current working-tree contents.
   - truncate to the first 400 lines per file when reading context
   - for tracked deletions, treat the file as \`<deleted from working tree; no current file contents>\`
6. Append untracked non-ignored files:
   - list them with \`git ls-files --others --exclude-standard | LC_ALL=C sort\`
   - append each to the changed-files list as \`A<TAB><path>\`
   - for each file, append a synthetic new-file patch with \`git diff --no-index --binary -- /dev/null "$path" || true\`
   - keep synthetic patches in stable sorted path order

## Finding Rules

- Findings must target lines in files changed by this full local diff.
- \`code_location\` must overlap the relevant diff hunk when possible.
- Use one finding per distinct issue.
- Keep ranges as short as possible. Avoid ranges longer than 5-10 lines.
- Do not stop at the first valid finding. Return all valid findings.

## Comment Rules

For each finding:

1. Make the title start with a priority tag, for example \`[P1] Wrong cache key for tenant lookup\`.
2. Make the body brief, factual, and specific about why this is a bug.
3. Explain the scenario, input, or environment required for the bug to happen when relevant.
4. Keep the body to one paragraph.
5. Do not include code snippets longer than 3 lines.
6. Use \`suggestion\` blocks only for concrete replacement code.
7. In any \`suggestion\` block, preserve exact leading whitespace.
8. Do not add or remove outer indentation unless that is the actual fix.
9. Avoid unnecessary file or location chatter in the prose; the inline location already provides context.
10. Do not generate a PR fix unless a minimal \`suggestion\` block is genuinely needed.

## Priority Scale

- \`P0\` / \`priority: 0\`: release-blocking or universally severe issue
- \`P1\` / \`priority: 1\`: urgent issue that should be fixed in the next cycle
- \`P2\` / \`priority: 2\`: normal bug to fix eventually

If priority is unclear or lower than P2, omit the finding.

## Overall Verdict

At the end, decide whether the full local diff is correct.

- \`"correct"\` means the full local diff has no P0, P1, or P2 findings.
- \`"incorrect"\` means at least one P0, P1, or P2 finding remains.

Ignore sub-P2 concerns when choosing the overall verdict. If the PR branch has only sub-P2 concerns, return \`findings: []\` and \`overall_correctness: "correct"\`.

## Output Format

Return strict JSON only. Do not include markdown fences or extra prose.

The JSON must match this schema exactly:

{
  "findings": [
    {
      "title": "<≤ 80 chars, imperative>",
      "body": "<valid Markdown explaining *why* this is a problem; cite files/lines/functions>",
      "confidence_score": <float 0.0-1.0>,
      "priority": <int 0-2>,
      "code_location": {
        "absolute_file_path": "<file path>",
        "line_range": {"start": <int>, "end": <int>}
      }
    }
  ],
  "overall_correctness": "correct" | "incorrect",
  "overall_explanation": "<1-3 sentence explanation justifying the overall_correctness verdict>",
  "overall_confidence_score": <float 0.0-1.0>
}

Additional output rules:

- \`code_location.absolute_file_path\` is required.
- \`code_location.line_range.start\` and \`code_location.line_range.end\` are required.
- The \`code_location\` range should overlap the diff.
- Do not wrap the JSON in markdown fences or extra prose.
- Do not generate a PR fix.
`;

function parseArgs(argv) {
  const args = {
    worktreeRoot: null,
    repo: null,
    branch: null,
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
    } else if (arg === "--branch") {
      args.branch = value;
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
  if (!args.branch && !(args.prNumber && args.prUrl && args.baseRef)) {
    throw new Error(
      "--branch is required unless --pr-number, --pr-url, and --base-ref are supplied",
    );
  }

  return args;
}

function renderPrReviewerPrompt(args) {
  const replacements = {
    "{worktree_root}": args.worktreeRoot,
    "{repo}": args.repo,
    "{pr_number}": args.prNumber,
    "{pr_url}": args.prUrl,
    "{pr_title}": args.prTitle,
    "{base_ref}": args.baseRef,
    "{head_ref}": args.headRef,
    "{head_sha}": args.headSha,
    "{remote_head_sha}": args.remoteHeadSha,
    "{review_base}": args.reviewBase,
    "{changed_files}": args.changedFiles,
  };
  const pattern =
    /\{worktree_root\}|\{repo\}|\{pr_number\}|\{pr_url\}|\{pr_title\}|\{base_ref\}|\{head_ref\}|\{head_sha\}|\{remote_head_sha\}|\{review_base\}|\{changed_files\}/g;

  return PR_REVIEWER_PROMPT_TEMPLATE.replace(pattern, (match) =>
    String(replacements[match]),
  );
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error.message}`);
  }
}

function loadPrMetadata({ worktreeRoot, repo, prNumber, branch }) {
  const selector = prNumber || branch;
  const result = runSync(
    "gh",
    [
      "pr",
      "view",
      "--repo",
      repo,
      selector,
      "--json",
      "number,url,title,baseRefName,headRefName,headRefOid",
    ],
    { cwd: worktreeRoot, log },
  );
  assertZero(result, "load PR metadata");
  return parseJson(result.stdout, "gh pr view");
}

function buildChangedFiles({ worktreeRoot, reviewBase }) {
  const changedFilesResult = runSync(
    "git",
    ["diff", "--name-status", reviewBase],
    { cwd: worktreeRoot, log },
  );
  assertZero(changedFilesResult, "load tracked changed files");

  const untrackedResult = runSync(
    "git",
    ["ls-files", "--others", "--exclude-standard"],
    { cwd: worktreeRoot, log },
  );
  assertZero(untrackedResult, "load untracked changed files");

  const lines = [];
  if (getText(changedFilesResult.stdout)) {
    lines.push(getText(changedFilesResult.stdout));
  }
  const untrackedFiles = getText(untrackedResult.stdout)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
  lines.push(...untrackedFiles.map((file) => `A\t${file}`));

  return lines.length > 0 ? lines.join("\n") : "<no changed files>";
}

function buildReviewMetadata({
  worktreeRoot,
  repo,
  branch,
  prNumber,
  prUrl,
  baseRef,
}) {
  const pr = loadPrMetadata({ worktreeRoot, repo, prNumber, branch });
  if (prNumber && String(pr.number) !== String(prNumber)) {
    throw new Error(`PR number mismatch: expected ${prNumber}, got ${pr.number}`);
  }
  if (prUrl && pr.url !== prUrl) {
    throw new Error(`PR URL mismatch: expected ${prUrl}, got ${pr.url}`);
  }
  if (baseRef && pr.baseRefName !== baseRef) {
    throw new Error(
      `PR base ref mismatch: expected ${baseRef}, got ${pr.baseRefName}`,
    );
  }

  const fetchResult = runSync("git", ["fetch", "origin", pr.baseRefName], {
    cwd: worktreeRoot,
    log,
    timeout: 120_000,
  });
  assertZero(fetchResult, "git fetch base branch");

  const branchResult = runSync("git", ["branch", "--show-current"], {
    cwd: worktreeRoot,
    log,
  });
  assertZero(branchResult, "load local branch");
  const localBranch = getText(branchResult.stdout);
  if (localBranch !== pr.headRefName) {
    throw new Error(
      `local branch does not match PR head: local=${localBranch} pr=${pr.headRefName}`,
    );
  }

  const headResult = runSync("git", ["rev-parse", "HEAD"], {
    cwd: worktreeRoot,
    log,
  });
  assertZero(headResult, "load local HEAD SHA");
  const localHead = getText(headResult.stdout);
  if (localHead !== pr.headRefOid) {
    throw new Error(
      `local HEAD does not match PR head: local=${localHead} pr=${pr.headRefOid}`,
    );
  }

  const mergeBaseResult = runSync(
    "git",
    ["merge-base", "HEAD", `origin/${pr.baseRefName}`],
    { cwd: worktreeRoot, log },
  );
  assertZero(mergeBaseResult, "compute PR review base commit");
  const reviewBase = getText(mergeBaseResult.stdout);

  return {
    repo,
    pr_number: String(pr.number),
    pr_url: pr.url,
    pr_title: pr.title,
    base_ref: pr.baseRefName,
    head_ref: pr.headRefName,
    head_sha: localHead,
    remote_head_sha: pr.headRefOid,
    review_base: reviewBase,
    changed_files: buildChangedFiles({ worktreeRoot, reviewBase }),
  };
}

export async function runDualPrBranchReview({
  worktreeRoot,
  repo,
  branch,
  prNumber,
  prUrl,
  baseRef,
  reviewSchemaPath = REVIEW_OUTPUT_SCHEMA_PATH,
  reviewSchema = fs.readFileSync(reviewSchemaPath, "utf8").trim(),
  timeout = DEFAULT_REVIEW_TIMEOUT_MS,
}) {
  log(
    `start worktree_root=${worktreeRoot} repo=${repo} pr_number=${prNumber} base_ref=${baseRef}`,
  );
  const metadata = buildReviewMetadata({
    worktreeRoot,
    repo,
    branch,
    prNumber,
    prUrl,
    baseRef,
  });
  const prompt = renderPrReviewerPrompt({
    worktreeRoot,
    repo: metadata.repo,
    prNumber: metadata.pr_number,
    prUrl: metadata.pr_url,
    prTitle: metadata.pr_title,
    baseRef: metadata.base_ref,
    headRef: metadata.head_ref,
    headSha: metadata.head_sha,
    remoteHeadSha: metadata.remote_head_sha,
    reviewBase: metadata.review_base,
    changedFiles: metadata.changed_files,
  });

  const aggregate = await runDualReviewPrompt({
    worktreeRoot,
    prompt,
    reviewSchemaPath,
    reviewSchema,
    timeout,
  });

  log(`aggregate status=${aggregate.status}`);
  return aggregate;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await runDualPrBranchReview(args);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    log(`error: ${error.message}`);
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
