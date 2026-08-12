---
name: address-pr-comments
description: "Process unresolved PR review threads for the PR associated with the current branch, or classify provided reviewer comment text against that PR: no-op when nothing remains, create a comment address plan, stop for approval, reply when approved, and send actionable work to `code-implement-loop`."
---

# Address PR Comments

Process unresolved PR review threads for the pull request that is already checked out locally. Infer the PR from the current branch. If reviewer comment text is supplied directly, use that provided text instead of loading unresolved review threads from GitHub.

## Hard Rules

- First, review the `# Global Rules` from your memory file and apply them before the skill-specific rules below.
- Always infer the PR from the current branch with `gh`, then validate that local state matches the inferred PR.
- Invoke `plan-pr-comments` only once to create the initial plan. Handle every user-requested plan revision inside this skill without invoking the planner again.
- Always stop after the classification step and present the comment address plan to the user. The user may request plan revisions multiple times. Never proceed to reply or delegation until the user explicitly approves the current plan.
- Treat the user-approved comment address plan as the source of truth. Before delegating actionable work, derive an implementation plan containing only the approved `implementation_needed` item sections; never pass `reply_only` sections or discussion URLs to `code-implement-loop`.
- Do not add scope beyond the unresolved actionable review feedback.
- Do not post follow-up replies after `code-implement-loop` finishes.

## Input Contract

- Accept no flags.
- Accept either no input or provided reviewer comment text.
- If no reviewer comment text is supplied, run the unresolved-review-thread workflow.
- If reviewer comment text is supplied, use that text instead of loading unresolved review threads from GitHub.
- Treat supplied text as comment content, not as PR identity. Do not parse PR URLs or review URLs from the supplied text.
- Valid inputs:
  - no input
  - `<reviewer-comment-text>`

## Workflow

### 0) Preflight

1. Resolve repo scope and enforce the strict coding preflight:
   - `eval "$("$HOME/dotfiles/scripts/coding-preflight.mjs")"`
   - The helper must provide: `inside_worktree`, `worktree_root`, `worktree_path`, `branch`, `repo`, `in_dd_scope`, `origin_branch_ref`, `origin_branch_exists`, `local_ahead_count`, `origin_ahead_count`.
   - If helper exits non-zero, stop and report blocked status with helper stderr.
2. `cd "$worktree_root"`.
3. Load the PR associated with the current branch:

```bash
if ! pr_meta_json="$(gh pr view --repo "$repo" "$branch" --json number,url,baseRefName,headRefName,headRefOid)"; then
  echo "FAILED: current branch has no associated PR"
  exit 1
fi
```

4. Parse from `pr_meta_json`:
   - `pr_number`
   - `pr_url`
   - `base_ref`
   - `head_ref`
   - `head_sha`

```bash
pr_number="$(jq -r '.number' <<<"$pr_meta_json")"
pr_url="$(jq -r '.url' <<<"$pr_meta_json")"
base_ref="$(jq -r '.baseRefName' <<<"$pr_meta_json")"
head_ref="$(jq -r '.headRefName' <<<"$pr_meta_json")"
head_sha="$(jq -r '.headRefOid' <<<"$pr_meta_json")"
```

If `pr_url` is empty or `null`, stop and return `FAILED: current branch has no associated PR`.

5. Get the authenticated GitHub login:

```bash
comment_author_login="$(gh api user --jq '.login')"
```

If `comment_author_login` is empty, stop and return `FAILED: unable to determine authenticated GitHub login`.

6. Confirm the current checkout matches the inferred PR:
   - `branch` from the helper must equal `head_ref`
   - `git rev-parse HEAD` must equal `head_sha`
   - if any check fails, stop and report the mismatch

### 1) Create the comment address plan

1. Reject any flag as `FAILED: unsupported flag: <flag>`.
2. Treat all non-flag input as `provided_comment_text`.
3. Invoke the `plan-pr-comments` skill exactly once to create the initial plan. Use `$HOME/dotfiles/claude-skills/plan-pr-comments/SKILL.md` with:
   - the validated `pr_url`
   - `provided_comment_text` when the user supplied it
4. After the planner returns, this skill owns `comments_to_address` and `comment_address_plan`. Treat them as the source of truth. Do not invoke `plan-pr-comments` again or reload the comments.
5. If the planner returns `NOOP: no comments to address`, return that result and stop.
6. Before presenting `comment_address_plan`, update only each `reply_only` plan so its `reply_body` is the exact substantive reply prefixed by the global GitHub pull request comment disclosure. Use `comment_author_login` for the authenticated GitHub login.
7. Keep the resulting prefixed plan as `comment_address_plan`. Do not change any raw comment, decision, reasoning, or `implementation_needed` plan.

Approval gate:

- Stop here and return only the plan plus:
  - `PLAN_READY: approve this plan to continue, or request revisions.`
- If the user requests revisions, revise the current `comment_address_plan` entirely within this skill. Preserve `comments_to_address`, apply the Step 1 reply-prefix rule again, and stop at this gate again. Do not invoke `plan-pr-comments` again or reload the comments.
- Only treat an explicit approval of the current plan as permission to continue. Examples: `approved`, `approve this plan`, `looks good, proceed`, `continue with this plan`.

### 2) Reply to clarification-only items

Do this step only after Step 1 has produced a comment address plan and the user explicitly approved the current plan.

For each `reply_only` item:

1. Use the approved `reply_body` from the plan exactly as written.
2. Verify that `reply_body` follows the global GitHub pull request comment disclosure rule. Do not add or rewrite text after approval.
3. If `source` is `unresolved_thread`, reply with:
   - `"$HOME/dotfiles/claude-skills/address-pr-comments/scripts/reply_to_review_thread.sh" "$repo" "<pr-number>" "<last-comment-id>" "<reply_body>"`
   - Do not resolve the thread.
4. If `source` is `provided_comment`, return `reply_body` in the final status. Do not post it to GitHub because provided comments have no thread target.

### 3) Delegate actionable items

If one or more items are `implementation_needed`:

1. Preserve the exact plan version approved by the user as `approved_comment_address_plan`.
2. Before invoking `code-implement-loop`, derive `implementation_plan` by copying only the complete item sections whose approved decision is `implementation_needed` from `approved_comment_address_plan`, in their original order.
3. Preserve each copied section verbatim, including its heading, raw comment, decision, reasoning, and plan. Do not reclassify, reinterpret, summarize, or expand it.
4. Verify that `implementation_plan` is non-empty and contains no `reply_only` item section. If this check fails, stop and return `BLOCKED: failed to build actionable implementation plan | PR: {url}`.
5. Invoke `code-implement-loop` once, using the filtered `implementation_plan` as its direct inline implementation input.
6. Do not pass discussion URLs or fetch additional PR comments during delegation. Only the approved `implementation_needed` sections are authoritative implementation context.

Example input to `code-implement-loop`:

```text
# Approved PR comment address plan

## thread-1 - Preserve legacy behavior

Raw comment:
Please preserve the existing caller behavior here.

Decision: implementation_needed

Reasoning:
The existing caller still depends on this behavior.

Plan:
Update the condition and add a regression test for the existing caller.
```

### 4) Return final status

Use one of these formats:

- `SUCCESS: replied to {N} unresolved thread(s) | PR: {url}`
- `SUCCESS: delegated {M} unresolved thread(s) to code-implement-loop | PR: {url}`
- `SUCCESS: replied to {N} unresolved thread(s); delegated {M} unresolved thread(s) | PR: {url}`
- `SUCCESS: prepared {N} reply/replies for provided comment(s) | PR: {url}`
- `SUCCESS: delegated {M} provided comment(s) to code-implement-loop | PR: {url}`
- `SUCCESS: prepared {N} reply/replies for provided comment(s); delegated {M} provided comment(s) | PR: {url}`
- `BLOCKED: {reason} | PR: {url}`
