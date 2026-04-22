---
name: pr-review-guidance
description: "Create or update a top-level PR review-guidance comment from a GitHub PR URL. Read the PR thoroughly with `gh`, then post a marked review guide comment in the example structure."
---

# PR Review Guidance

Create or update a top-level review-guidance comment for a GitHub pull request.

## Hard Rules

- Accept exactly one GitHub PR URL.
- Use `gh` for all GitHub access.
- Do not rely on a local checkout.
- Stop if the PR author is not `pingxia23`.
- Only update comments owned by this skill marker: `<!-- pr-review-guidance:v1 -->`.
- Never delete or replace unmarked comments.
- Do not post a draft as a reply or review-thread comment; use a normal top-level PR comment.

## Input Contract

- Input: one PR URL such as `https://github.com/DataDog/dd-source/pull/416393`
- If the URL is missing or malformed, stop and return:
  - `FAILED: provide a PR URL`

## Workflow

### 1) Snapshot PR context

Run:

```bash
"$HOME/dotfiles/scripts/fetch-pr-context.sh" "<pr-url>"
```

The script prints JSON with:

- `repo`
- `pr_number`
- `pr_url`
- `author_login`
- `head_sha`
- `bundle_dir`

Inside `bundle_dir`, read these files as needed:

- `pr.json` - PR metadata summary
- `files.json` - changed files with patches when GitHub provides them
- `diff.patch` - full PR patch
- `comments.json` - top-level PR conversation comments
- `review_threads.json` - unresolved, non-outdated review threads

### 2) Verify ownership

- Stop immediately unless `author_login` is exactly `pingxia23`.
- Return:
  - `BLOCKED: PR author is <login>, expected pingxia23 | PR: <url>`

### 3) Build understanding

Read the PR thoroughly before writing the comment:

- Start with `pr.json`, `files.json`, and `diff.patch`.
- Read `review_threads.json` and `comments.json` for any additional context.
- If the patch is not enough to explain semantics, fetch head-file contents for a small number of key files:

```bash
gh api -H 'Accept: application/vnd.github.raw+json' \
  "repos/<owner>/<repo>/contents/<path>?ref=<head_sha>"
```

Build an actual model of behavior, data flow, risk, and review hotspots. Do not just paraphrase the PR title or body.

### 4) Write the guidance comment

The comment body must begin with the hidden marker:

```html
<!-- pr-review-guidance:v1 -->
```

Then use this visible structure:

```markdown
## PR Summary & Review Guide

### What this PR does
...

**Key changes, in dependency order:**

1. ...

### What to focus on during review

- ...

### What you can skim

- ...
```

Guidance rules:

- Summarize the real behavior change and current implementation state.
- Order key changes by dependency or data flow, not file order.
- Call out review hotspots around semantics, auth, failure handling, compatibility, and trust boundaries when relevant.
- Put generated or mechanical changes in `What you can skim`.
- Use information from existing comments/reviews only as supporting context.
- Keep the tone and section shape close to the inlined reference example above.

### 5) Upsert the top-level comment

Pipe the final comment body into:

```bash
"$HOME/dotfiles/claude-skills/pr-review-guidance/scripts/upsert_review_guidance_comment.sh" "<pr-url>" -
```

The script will:

- update the most recent top-level comment by `pingxia23` that contains the hidden marker, or
- create a new top-level PR comment if no marked comment exists

It prints JSON including:

- `action` - `created` or `updated`
- `comment_url`

### 6) Return final status

Use one of:

- `SUCCESS: posted review guidance | Comment: <url>`
- `SUCCESS: updated existing review guidance | Comment: <url>`
- `BLOCKED: unable to load PR data | PR: <url>`
