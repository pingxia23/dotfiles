---
name: pr-body
description: "Create or update the managed GitHub PR body for a PR URL. Use when a workflow needs to initialize or refresh the managed Problem and Approach sections on an existing PR."
---

# PR Body

Create or update the managed body for an existing GitHub PR.

## Input

Required:
- PR URL

## Workflow

1. Infer `repo` from the PR URL or current git context.
2. Load the PR:

   ```bash
   gh pr view --repo "$repo" "$pr_url" --json title,body,commits,files
   ```

3. Inspect the full PR change:

   ```bash
   gh pr diff --repo "$repo" "$pr_url"
   ```

4. Apply the managed PR body rules below.
5. Return one of:
   - `UPDATED: PR body updated | PR: <url>`
   - `SKIPPED: existing PR body is manually edited | PR: <url>`
   - `BLOCKED: PR body update failed | PR: <url> | Error: <summary>`

## Managed PR Body Rules

Only update the PR body when either:
- the existing PR body is empty
- the existing PR body starts with the hidden marker:

```html
<!-- ping-xia-pr-body:v1 -->
```

If the existing PR body is non-empty and does not start with this marker, treat it as manually edited and skip the PR body update.

Update the managed body by splicing new generated content into the existing body:

1. If the existing PR body is empty, initialize the base text to the hidden marker followed by a blank line.
2. Otherwise, keep the original body as the base text. Do not regenerate the whole body from scratch.
3. Locate level-2 section headings with lines that start with `## `.
4. Generate new content only for the managed `## Problem` and `## Approach` sections, using the PR title, managed body, commit list, changed files, and full PR diff.
   - Write for a reviewer who is deciding what to inspect first.
   - Prefer concrete review areas over broad architecture phrasing.
   - Do not compress multiple subsystems into one long sentence.
   - Do not enumerate every touched file, test, or mechanical edit.
   - If the PR spans multiple subsystems, use short bullets grouped by review boundary.
5. Upsert the `## Problem` section:
   - If a line exactly matching `## Problem` exists, replace that full section. The section starts at `## Problem` and ends immediately before the next `## ` heading, or at end of body.
   - If it does not exist, create a new `## Problem` section after the marker and any immediately following blank lines.
6. Upsert the `## Approach` section:
   - If a line exactly matching `## Approach` exists, replace that full section. The section starts at `## Approach` and ends immediately before the next `## ` heading, or at end of body.
   - If it does not exist, create a new `## Approach` section immediately after the `## Problem` section.
7. The `## Problem` section must be concise and reviewer-digestible:

   ```markdown
   ## Problem

   <why this change is needed>
   ```

   Requirements:
   - State the current limitation or missing capability in plain language.
   - State the user-visible or reviewer-visible outcome this PR enables.
   - Keep it to 1-2 short paragraphs or 2-3 bullets.
   - Avoid umbrella phrases like "end-to-end path" unless the following text names the concrete boundaries.
8. The `## Approach` section must be concise and reviewer-digestible:

   ```markdown
   ## Approach

   <key implementation choices>
   ```

   Requirements:
   - Organize by review boundary, not by commit order.
   - For multi-subsystem PRs, prefer 3-5 bullets with bold labels.
   - Each bullet should name what changed and why that boundary matters.
   - Mention tests only when they clarify behavior coverage or reviewer risk.
   - Keep implementation detail high-level enough that a reviewer can choose where to dive into the diff.
9. Leave every byte outside those two managed sections unchanged. Do not edit, reorder, remove, or regenerate any other section or content.
10. Then update the PR body with:

```bash
gh pr edit --repo "$repo" "$pr_url" --body-file "<body-file>"
```

**Focus on the high-level problem and approach**

- Skip mechanical details such as added unit tests, renamed variables, changed function arguments, or other implementation minutiae unless they are essential to understanding the design.
- The goal is to state the problem clearly and lay out the high-level approach so reviewers can review the PR efficiently.
- The output should help reviewers triage the diff. If the generated text reads like an abstract design summary, rewrite it around concrete review boundaries.

For a large background-worker PR, prefer this shape over a dense paragraph:

```markdown
## Problem

Foreground assistant requests need to accept long-running work quickly without keeping the request open. Today there is no typed handoff to a background worker that can report progress and write the final result back to the conversation.

This PR adds that handoff, so reviewers should focus on the API-to-worker contract, callback validation, and persistence behavior.

## Approach

- **Worker contract:** Add typed start-task and worker-message callback payloads, including callback context and `PROGRESS`/`FINAL` event shapes.
- **Worker runtime:** Implement the assistant-agent-worker workflow, activity execution, demo agent, and callback client.
- **API integration:** Expose the start-background-task tool from assistant_api, start the worker workflow, and validate worker callbacks before persisting conversation updates.
- **Shared definitions and docs:** Keep shared agent definitions in the assistant library and document the V1 boundary in ADR-004.
```
