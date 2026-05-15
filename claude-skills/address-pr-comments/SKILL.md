---
name: address-pr-comments
description: "Process unresolved PR review threads for the PR associated with the current branch, or classify provided reviewer comment text against that PR: no-op when nothing remains, create a comment address plan, stop for approval, reply when approved, and send actionable work to `code-implement-loop`."
---

# Address PR Comments

Process unresolved PR review threads for the pull request that is already checked out locally. Infer the PR from the current branch. If reviewer comment text is supplied directly, use that provided text instead of loading unresolved review threads from GitHub.

## Hard Rules

- First, review the `# Global Rules` from your memory file and apply them before the skill-specific rules below.
- Always infer the PR from the current branch with `gh`, then validate that local state matches the inferred PR.
- Always stop after the classification step and present the comment address plan to the user. The user may request plan revisions multiple times. Never proceed to reply or delegation until the user explicitly approves the current plan.
- Do not add scope beyond the unresolved actionable review feedback.
- Do not post follow-up replies after `code-implement-loop` finishes.
- Every GitHub reply or PR comment posted by this skill must start with exactly:

```text
AI generated Comment
<actual comment>
```

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

5. Confirm the current checkout matches the inferred PR:
   - `branch` from the helper must equal `head_ref`
   - `git rev-parse HEAD` must equal `head_sha`
   - if any check fails, stop and report the mismatch

### 1) Parse input

1. Parse the invocation arguments:
   - reject any flag as `FAILED: unsupported flag: <flag>`
   - treat all non-flag input as `provided_comment_text`
   - preserve multiline text and formatting when building the raw comment
   - if the provided text contains multiple clearly separated reviewer comments, keep them as separate `provided-comment-{N}` items; otherwise treat the full text as one comment

### 2) Confirm inferred PR scope

Use only the inferred `pr_url` for the rest of the workflow. Directly supplied comment text changes the feedback source, not the PR identity.

### 3) Build `comments_to_address`

Build one `comments_to_address` collection. Each item in the collection is a `comment_to_address` record. Every later step must read from this collection instead of branching back to the original input source.

If `provided_comment_text` was supplied:

1. Convert the supplied text into one or more `comment_to_address` records in `comments_to_address`.
2. Preserve multiline text and formatting in `raw_comment`.
3. If the provided text contains multiple clearly separated reviewer comments, create one item per comment; otherwise treat the full text as one comment.
4. Each provided-comment item must include:
   - `source: provided_comment`
   - `id: provided-comment-{N}`
   - `raw_comment`

If `provided_comment_text` was not supplied:

1. Run:
   - `"$HOME/dotfiles/claude-skills/address-pr-comments/scripts/list_unresolved_review_threads.sh" "$pr_url"`
2. Treat the script output as the source of truth for unresolved review threads.
3. Convert each returned unresolved, non-outdated review thread into one `comment_to_address` record in `comments_to_address`.
4. Each unresolved-thread `comment_to_address` record must include:
   - `source: unresolved_thread`
   - `id: <thread_id>`
   - `raw_comment: <last_comment_body>`
   - `thread_id`
   - `path`
   - `line`
   - `original_line`
   - `diff_hunk`
   - `comment_url`
   - `last_comment_id`
   - `last_comment_body`
   - `comments[]`

If `comments_to_address` is empty, stop and return:

- `NOOP: no comments to address`

### 4) Classify each item

Classify each `comments_to_address` item into one of:

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

Before taking any action, create a comment address plan that covers every `comments_to_address` item. Use this format for each item:

```markdown
## <comments_to_address.id> - <short title>

Raw comment:
<raw reviewer comment>

Decision: reply_only | implementation_needed

Reasoning:
<why this classification is correct from the current code and PR state>

Plan:
<for reply_only, set reply_body to the exact prefixed reply.>

<for implementation_needed, describe the concrete code, test, docs, or config changes needed. Prefer pseudocode over prose.>

<for future-work comments, identify where the TODO comment should be added and what it should say.>
```

Approval gate:

- Stop here and return only the plan plus:
  - `PLAN_READY: approve this plan to continue, or request revisions.`
- If the user requests revisions, update the plan and stop at this gate again.
- Only treat an explicit approval of the current plan as permission to continue. Examples: `approved`, `approve this plan`, `looks good, proceed`, `continue with this plan`.

### 5) Reply to clarification-only items

Do this step only after Step 4 has produced a comment address plan and the user explicitly approved the current plan.

For each `reply_only` item:

1. Use the approved `reply_body` from the plan.
2. The `reply_body` must start with `AI generated Comment` on the first line, followed by the actual reply text on the next line.
3. If `source` is `unresolved_thread`, reply with:
   - `"$HOME/dotfiles/claude-skills/address-pr-comments/scripts/reply_to_review_thread.sh" "$repo" "<pr-number>" "<last-comment-id>" "<reply_body>"`
   - Do not resolve the thread.
4. If `source` is `provided_comment`, return `reply_body` in the final status. Do not post it to GitHub because provided comments have no thread target.

### 6) Delegate actionable items

If one or more items are `implementation_needed`:

1. For `unresolved_thread` items, collect only the actionable URLs from `comment_url`.
2. For `provided_comment` items, include the raw provided comment text and approved plan text in the handoff, scoped to the inferred `pr_url`.
3. Invoke `code-implement-loop` once with only the actionable unresolved-thread URLs and/or provided-comment handoff text as the implementation scope.
4. Do not restate the requests or add broader work items if the links or provided comments already identify the actionable feedback.
5. If an item is actionable only because it requests future work, include the approved plan text for that item in the `code-implement-loop` handoff so the implementation scope is limited to adding the TODO comment, not implementing the future work.

Example input to `code-implement-loop`:

```text
https://github.com/owner/repo/pull/123#discussion_r111
https://github.com/owner/repo/pull/123#discussion_r222
```

### 7) Return final status

Use one of these formats:

- `SUCCESS: replied to {N} unresolved thread(s) | PR: {url}`
- `SUCCESS: delegated {M} unresolved thread(s) to code-implement-loop | PR: {url}`
- `SUCCESS: replied to {N} unresolved thread(s); delegated {M} unresolved thread(s) | PR: {url}`
- `SUCCESS: prepared {N} reply/replies for provided comment(s) | PR: {url}`
- `SUCCESS: delegated {M} provided comment(s) to code-implement-loop | PR: {url}`
- `SUCCESS: prepared {N} reply/replies for provided comment(s); delegated {M} provided comment(s) | PR: {url}`
- `BLOCKED: {reason} | PR: {url}`
