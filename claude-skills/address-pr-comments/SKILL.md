---
name: address-pr-comments
description: "Process unresolved PR review threads from a PR URL: no-op when none remain, reply to clarification-only threads with gh, and send actionable thread links to `code-implement-loop`."
---

# Address PR Comments

Process unresolved PR review threads for a pull request that is already checked out locally.

## Hard Rules

- Use `gh` for all GitHub interactions.
- Only inspect unresolved, non-outdated PR review threads.
- Ignore top-level PR conversation comments.
- Never resolve GitHub threads.
- Assume the current worktree is already on the PR branch in the correct repository.
- Do not add scope beyond the unresolved actionable review feedback.
- Do not post follow-up replies after `code-implement-loop` finishes.

## Input Contract

- Accept exactly one PR URL.
- If the PR URL is missing, stop and return:
  - `FAILED: provide a PR URL`

## Workflow

### 1) Normalize local context

1. Load shared git context:
   - `eval "$("$HOME/dotfiles/scripts/git-context.sh")"`
2. Stop if the helper exits non-zero.
3. Use `repo` from the helper and pass `--repo "$repo"` to all direct `gh` commands.

Purpose:
- bind GitHub operations to the current checkout explicitly
- keep local file reads and diffs anchored to the active repo

### 2) Load unresolved review threads

1. Run:
   - `"$HOME/dotfiles/claude-skills/address-pr-comments/scripts/list_unresolved_review_threads.sh" "<pr-url>"`
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

### 3) No-op when nothing remains

- If no unresolved, non-outdated review threads remain, stop and return:
  - `NOOP: no unresolved review threads`

### 4) Classify each unresolved thread

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
  - replying alone would overstate what has been fixed
  - the request is ambiguous; default here conservatively

### 5) Reply to clarification-only threads

For each `reply_only` thread:

1. Draft a concise factual reply.
2. Reply with:
   - `"$HOME/dotfiles/claude-skills/address-pr-comments/scripts/reply_to_review_thread.sh" "$repo" "<pr-number>" "<last-comment-id>" "<reply-body>"`
3. Do not resolve the thread.

### 6) Delegate actionable threads

If one or more threads are `implementation_needed`:

1. Collect only the actionable comment URLs from `comment_url`.
2. Invoke `code-implement-loop` once with those URLs as the entire implementation scope.
3. Do not restate the requests or add broader work items if the links already identify the actionable unresolved feedback.

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
- `BLOCKED: {reason} | PR: {url}`
