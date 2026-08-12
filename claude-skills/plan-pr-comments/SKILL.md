---
name: plan-pr-comments
description: "Create the initial read-only action plan for unresolved pull request review threads or supplied reviewer comment text. Use when a PR workflow needs to load, filter, inspect, classify, and initially plan review feedback without revising a prior plan, requesting approval, posting replies, changing code, or invoking implementation."
---

# Plan PR Comments

Create one initial canonical comment address plan. Return the plan to the caller without taking action.

## Hard Rules

- First, review the `# Global Rules` from your memory file and apply them before the skill-specific rules below.
- Keep this workflow read-only. Do not request approval, post replies, resolve threads, change files, or invoke another implementation skill.
- Create only the initial plan. Do not revise an existing plan or process user feedback about a plan.
- Use only the supplied and validated PR URL when a caller provides one.
- Do not add scope beyond the review feedback.
- Preserve every included comment in the returned plan.

## Input Contract

Accept these inputs:

- a validated `pr_url` from a caller, with optional `provided_comment_text`
- no caller context, in which case infer and validate the PR from the current branch

Accept comment sources only. Do not accept an existing plan or plan-revision instructions as input. The calling skill owns every later review or revision of the returned plan.

Treat `provided_comment_text` as comment content, not as PR identity. Preserve its multiline text and formatting. If it contains multiple clearly separated reviewer comments, keep them as separate items.

## Workflow

### 1) Resolve PR scope

If the caller supplies a validated `pr_url`, use it without loading the PR again.

Otherwise:

1. Resolve repo scope with:
   - `eval "$("$HOME/dotfiles/scripts/coding-preflight.mjs")"`
2. `cd "$worktree_root"`.
3. Infer the PR from the current branch with `gh pr view`.
4. Require the local branch and `HEAD` to match the PR head branch and SHA.
5. Stop with `FAILED: current branch has no associated PR` when no PR exists.

### 2) Build `comments_to_address`

Create one `comments_to_address` collection. Every later step must use this collection.

If `provided_comment_text` is present:

1. Create one record for each clearly separated reviewer comment, or one record for the complete text when it is not clearly separated.
2. Give each record:
   - `source: provided_comment`
   - `id: provided-comment-{N}`
   - `raw_comment`

Otherwise:

1. Run:

```bash
comments_json="$(
  "$HOME/dotfiles/claude-skills/plan-pr-comments/scripts/list_unresolved_review_threads.sh" \
    "$pr_url"
)"
```

2. Treat the script output as the source of truth for unresolved, non-outdated review threads.
3. Create one record for each thread with:
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

Ignore a comment that is written for the reviewer instead of the PR author, including a comment that starts with `For reviewer:`.

If no comments remain, return only:

`NOOP: no comments to address`

### 3) Classify each item

Classify each item as one of:

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

Before drafting `comment_address_plan` or a proposed reply, re-read the global `## Writing Style` section and apply it to the generated prose.

### 4) Build the initial canonical plan

Create one section for every item in `comments_to_address`:

```markdown
## <comments_to_address.id> - <short title>

Raw comment:
<raw reviewer comment>

Decision: reply_only | implementation_needed

Reasoning:
<why this classification is correct from the current code and PR state>

Plan:
<for reply_only, provide the substantive reply text without an AI disclosure>

<for implementation_needed, describe the concrete code, test, docs, or config changes needed. Prefer pseudocode over prose.>

<for future-work comments, identify where the TODO comment should be added and what it should say.>
```

Keep the complete Markdown result as `comment_address_plan`. Preserve `comments_to_address` so the caller can use thread metadata after it reviews the plan.

## Return Contract

- Return `NOOP: no comments to address` when the filtered collection is empty.
- Otherwise, return the initial `comment_address_plan` once, without an approval request or action.
- Stop after returning the initial plan. Do not handle user-requested or automated plan revisions.
- Do not change `comment_address_plan` for a caller-specific approval, reply, implementation, CI, or failure policy. The caller owns those policies.
