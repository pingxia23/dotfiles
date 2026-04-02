---
name: code-review
description: "Use for PR and patch review requests such as 'review this', 'review this PR', 'does this work', 'check reviewer feedback', or when a GitHub PR URL/number is provided. This skill runs one PR-aware review pass and is also used by `code-implement-loop` for each review round."
---

# Code Review

Perform a deterministic PR-aware code review pass.

## Overview

This skill is the shared single-pass review engine used in two modes:

- **Direct review mode**: inspect a PR, branch, patch, or reviewer thread and return findings-first human review output.
- **Delegated mode**: run one validated PR-aware review pass for another workflow such as `code-implement-loop`.

The caller owns any multi-round retry loop, fix application, and re-invocation policy.

## Hard Rules

- Treat the task as review, not implementation.
- Use `gh` for all GitHub interactions.
- Never resolve GitHub PR comments.
- Only address unresolved comments and threads when reviewer feedback is part of the task.
- Do not edit code in direct review mode unless the user explicitly asks to switch from review to implementation.

## Inputs

Accept one of the following:

1. A direct review request from the user:
   - PR URL or number
   - local branch or diff
   - reviewer feedback thread or comment URL
2. A delegated review request from another skill with:
   - task goal
   - verification summary
   - unresolved findings ledger from prior passes

## Review Scope Policy

- Use PR-aware review scope by default: review the full prospective PR delta from merge base to the current working tree, not only the latest local diff hunk.
- Re-review the full prospective PR delta each time the skill is invoked. Do not narrow scope to only previously flagged hunks.
- Focus on correctness, regression, security, compatibility, performance, and tests. Do not block on pure style nits.

## Step 1: Normalize Review Context

1. Normalize checkout context through the shared helper:
   - `eval "$("$HOME/dotfiles/scripts/git-context.sh")"`
   - The helper must provide: `inside_worktree`, `worktree_root`, `worktree_path`, `branch`, `repo`, `in_dd_scope`.
   - If helper exits non-zero, stop and report blocked status with helper stderr.
2. `cd "$worktree_root"` so review commands run from a stable root.
3. Resolve the review base branch:
   - `base_branch="$(gh pr list --repo "$repo" --head "$branch" --state open --json baseRefName --jq '.[0].baseRefName' 2>/dev/null || true)"`
   - If empty: `base_branch="$(gh repo view --repo "$repo" --json defaultBranchRef -q '.defaultBranchRef.name' 2>/dev/null || true)"`
   - If still empty: `base_branch=main`
4. Ensure the base ref exists locally:
   - `git fetch origin "$base_branch" --quiet` as best effort.
5. Compute merge base:
   - `merge_base="$(git merge-base HEAD "origin/$base_branch" 2>/dev/null || true)"`
   - If empty, stop and report explicit base-resolution failure.

## Step 2: Gather PR-Aware Review Inputs

1. Detect an open PR for the current branch when possible:
   - `pr_url="$(gh pr list --repo "$repo" --head "$branch" --state open --json url --jq '.[0].url' 2>/dev/null || true)"`
2. Gather unresolved review feedback when available:
   - default `unresolved_pr_feedback='[]'`
   - if `pr_url` exists, resolve `pr_number` and query unresolved, non-outdated review threads
3. Build the review context pack:
   - `review_diff=$(git diff --binary "$merge_base")`
   - `changed_files=$(git diff --name-status "$merge_base")`
   - current full contents of changed files from the working tree, truncated deterministically to the first 400 lines per file
   - verification outputs summary
   - unresolved findings ledger from prior passes
   - unresolved PR comments or threads

## Step 3: Run Reviewer

1. Use the canonical reviewer prompt file:
   - `references/reviewer-prompt-codex-cli.md`
2. Inject the following placeholders:
   - `{review_diff}`, `{changed_files}`, `{changed_file_context}`,
     `{task_goal}`, `{verification_summary}`,
     `{unresolved_findings_ledger}`, `{unresolved_pr_feedback}`
3. Launch a fresh reviewer sub-agent.
4. The reviewer must return strict JSON only, matching the schema in `references/reviewer-prompt-codex-cli.md`.

## Step 4: Validate Reviewer Output

1. Parse reviewer output as strict JSON with no markdown fences or extra prose.
2. Validate exactly against the `OUTPUT FORMAT` schema in `references/reviewer-prompt-codex-cli.md`.
3. If output is malformed or schema-invalid, rerun the reviewer once with a schema reminder.
4. If still invalid, stop and report blocked status with the invalid payload summary and validator errors.

## Step 5: Return Results

### Delegated mode

Return the validated reviewer JSON exactly, with no extra prose. The caller owns:
- approval evaluation
- retry or multi-round loop behavior
- fix application
- re-invocation after verification reruns

### Direct review mode

Convert the validated reviewer result into normal human review output:
- findings first, ordered by severity
- each finding should state the concrete risk, the affected file or location when available, and why it is a bug, regression, or test gap
- if there are no findings, state that explicitly before any short summary

