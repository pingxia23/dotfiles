---
name: address-pr-comments
description: "Process unresolved PR review threads from a PR URL, or focus on one direct top-level review URL: no-op when nothing remains, create a comment address plan, stop for approval unless `--auto-fix` is supplied, reply when enough, and send actionable links to `code-implement-loop`."
---

# Address PR Comments

Process unresolved PR review threads for a pull request that is already checked out locally. If the input URL points to a specific top-level review summary, focus only on that review instead of scanning the whole PR.

## Hard Rules

- First, review the `# Global Rules` from your memory file and apply them before the skill-specific rules below.
- For a plain PR URL, inspect unresolved, non-outdated PR review threads.
- For a direct `#pullrequestreview-{id}` URL, focus only on that one top-level review summary.
- Ignore top-level PR conversation comments.
- `--auto-fix` is the only input flag that may bypass the Step 5 approval stop.
- Without `--auto-fix`, always stop after Step 5 and present the comment address plan to the user. The user may request plan revisions multiple times. Never proceed to Step 6 until the user explicitly approves the current plan.
- Do not add scope beyond the unresolved actionable review feedback.
- Do not post follow-up replies after `code-implement-loop` finishes.

## Input Contract

- Accept exactly one PR URL and, optionally, one `--auto-fix` flag.
- Valid inputs:
  - `<pr-url>`
  - `<pr-url> --auto-fix`
  - `--auto-fix <pr-url>`
- If the PR URL is missing, stop and return:
  - `FAILED: provide a PR URL`
- If an unknown flag is present, stop and return:
  - `FAILED: unsupported flag: <flag>`
- If multiple PR URLs are present, stop and return:
  - `FAILED: provide exactly one PR URL`

## Workflow

### 0) Preflight

### 1) Normalize local context

1. Load shared git context:
   - `eval "$("$HOME/dotfiles/scripts/git-context.sh")"`
2. Stop if the helper exits non-zero.
3. Use `repo` from the helper and pass `--repo "$repo"` to all direct `gh` commands.

Purpose:

- bind GitHub operations to the current checkout explicitly
- keep local file reads and diffs anchored to the active repo

### 2) Route by input URL

1. If the input is a plain PR URL, do the usual unresolved-review-thread workflow below.
2. If the input is a direct `#pullrequestreview-{id}` URL, focus only on that top-level review summary.
3. Do not broaden a direct top-level review URL into a full-PR scan.

### 3) Plain PR URL: load unresolved review threads

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

### 4) Plain PR URL: no-op when nothing remains

- If no unresolved, non-outdated review threads remain, stop and return:
  - `NOOP: no unresolved review threads`

### 5) Classify each item

Classify each unresolved thread or direct top-level review into one of:

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

Before taking any action, create a comment address plan that covers every unresolved thread or direct top-level review in scope. Use this format for each item:

```markdown
## <comment-id-or-review-id> - <short title>

Raw comment:
<raw reviewer comment>

Decision: reply_only | implementation_needed

Reasoning:
<why this classification is correct from the current code and PR state>

Plan:
<for reply_only, the exact reply to post; for implementation_needed, the concrete code, test, docs, or config changes needed. For future-work comments, identify where the TODO comment should be added and what it should say.>
```

Approval gate:

- If `--auto-fix` was supplied, continue to Step 6.
- Otherwise, stop here and return only the plan plus:
  - `PLAN_READY: approve this plan to continue, or request revisions.`
- If the user requests revisions, update the plan and stop at this gate again.
- Only treat an explicit approval of the current plan as permission to continue. Examples: `approved`, `approve this plan`, `looks good, proceed`, `continue with this plan`.

### 6) Reply to clarification-only items

Do this step only after Step 5 has produced a comment address plan and either the user explicitly approved the current plan or the original input included `--auto-fix`.

For each `reply_only` thread:

1. Draft a concise factual reply.
2. Reply with:
   - `"$HOME/dotfiles/claude-skills/address-pr-comments/scripts/reply_to_review_thread.sh" "$repo" "<pr-number>" "<last-comment-id>" "<reply-body>"`
3. Do not resolve the thread.

For a direct `reply_only` top-level review summary:

1. Draft a concise factual reply.
2. Post a normal PR comment that references the input review URL.
3. Do not attempt to resolve anything.

### 7) Delegate actionable items

If one or more items are `implementation_needed`:

1. Collect only the actionable URLs:
   - for unresolved threads, use `comment_url`
   - for a direct top-level review, use the input URL
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
- `SUCCESS: replied to direct top-level review | PR: {url}`
- `SUCCESS: delegated direct top-level review to code-implement-loop | PR: {url}`
- `BLOCKED: {reason} | PR: {url}`
