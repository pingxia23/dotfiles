---
name: address-pr-comments
description: "Process unresolved PR review threads for the PR associated with the current branch: no-op when nothing remains, create a comment address plan, stop for approval, reply when approved, and send actionable links to `code-implement-loop`."
---

# Address PR Comments

Process unresolved PR review threads for the pull request that is already checked out locally. Infer the PR from the current branch; do not accept PR URLs or review URLs as input.

## Hard Rules

- First, review the `# Global Rules` from your memory file and apply them before the skill-specific rules below.
- Infer the PR from the current branch with `gh`, then validate that local state matches the inferred PR.
- Always stop after Step 5 and present the comment address plan to the user. The user may request plan revisions multiple times. Never proceed to Step 6 until the user explicitly approves the current plan.
- Do not add scope beyond the unresolved actionable review feedback.
- Do not post follow-up replies after `code-implement-loop` finishes.
- Every GitHub reply or PR comment posted by this skill must start with exactly:

```text
AI generated Comment
<actual comment>
```

## Input Contract

- Accept no input.
- Always infer the PR URL from the current branch and run the unresolved-review-thread workflow.

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

5. Confirm the current checkout matches the inferred PR:
   - `branch` from the helper must equal `head_ref`
   - `git rev-parse HEAD` must equal `head_sha`
   - if any check fails, stop and report the mismatch

### 1) Parse input

1. Parse the invocation arguments:
   - reject any flag as `FAILED: unsupported flag: <flag>`
   - reject any non-flag argument as `FAILED: unsupported input: <input>`

### 2) Confirm inferred PR scope

Use only the inferred `pr_url` for the rest of the workflow. Do not accept, parse, or route any PR URL or review URL from input.

### 3) Load unresolved review threads

1. Run:
   - `"$HOME/dotfiles/claude-skills/address-pr-comments/scripts/list_unresolved_review_threads.sh" "$pr_url"`
2. Treat the script output as the source of truth for unresolved review threads.
3. Each returned thread must include:
   - `thread_id`
   - `path`
   - `line`
   - `original_line`
   - `diff_hunk`
   - `comment_url`
   - `last_comment_id`
   - `last_comment_body`
   - `comments[]`

### 4) No-op when nothing remains

- If no unresolved, non-outdated review threads remain, stop and return:
  - `NOOP: no unresolved review threads`

### 5) Classify each item

Classify each unresolved thread into one of:

- `reply_only`
- `implementation_needed`

Use this rubric:

- `reply_only`:
  - the reviewer is asking for clarification, rationale, or acknowledgment
  - a truthful answer can be given from the current code and PR state
  - no code, test, docs, or config change is needed
- `implementation_needed`:
  - the reviewer requests or clearly implies a code, test, docs, or config change
  - the reviewer calls out future work, a follow-up PR, an optional/non-blocking improvement, or a longer-term TODO; address this by adding a concise TODO comment in the relevant code path instead of implementing the future work in the current PR
  - the request is ambiguous; default here conservatively

Before taking any action, create a comment address plan that covers every unresolved thread in scope. Use this format for each item:

```markdown
## <comment-id-or-review-id> - <short title>

Raw comment:
<raw reviewer comment>

Decision: reply_only | implementation_needed

Reasoning:
<why this classification is correct from the current code and PR state>

Plan:
<for reply_only, the exact prefixed reply to post; for implementation_needed, the concrete code, test, docs, or config changes needed. For future-work comments, identify where the TODO comment should be added and what it should say.>
```

Approval gate:

- Stop here and return only the plan plus:
  - `PLAN_READY: approve this plan to continue, or request revisions.`
- If the user requests revisions, update the plan and stop at this gate again.
- Only treat an explicit approval of the current plan as permission to continue. Examples: `approved`, `approve this plan`, `looks good, proceed`, `continue with this plan`.

### 6) Reply to clarification-only items

Do this step only after Step 5 has produced a comment address plan and the user explicitly approved the current plan.

For each `reply_only` thread:

1. Draft a concise factual reply.
2. Prefix the reply body with `AI generated Comment` on the first line, followed by the actual reply text on the next line.
3. Reply with:
   - `"$HOME/dotfiles/claude-skills/address-pr-comments/scripts/reply_to_review_thread.sh" "$repo" "<pr-number>" "<last-comment-id>" "<reply-body>"`
4. Do not resolve the thread.

### 7) Delegate actionable items

If one or more items are `implementation_needed`:

1. Collect only the actionable URLs:
   - for unresolved threads, use `comment_url`
2. Invoke `code-implement-loop` once with those URLs as the entire implementation scope.
3. Do not restate the requests or add broader work items if the links already identify the actionable unresolved feedback.
4. If an item is actionable only because it requests future work, include the approved plan text for that item in the `code-implement-loop` handoff so the implementation scope is limited to adding the TODO comment, not implementing the future work.

Example input to `code-implement-loop`:

```text
https://github.com/owner/repo/pull/123#discussion_r111
https://github.com/owner/repo/pull/123#discussion_r222
```

### 8) Return final status

Use one of these formats:

- `SUCCESS: replied to {N} unresolved thread(s) | PR: {url}`
- `SUCCESS: delegated {M} unresolved thread(s) to code-implement-loop | PR: {url}`
- `SUCCESS: replied to {N} unresolved thread(s); delegated {M} unresolved thread(s) | PR: {url}`
- `BLOCKED: {reason} | PR: {url}`
