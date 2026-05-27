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
8. The `## Approach` section must be concise, reviewer-digestible, and organized into two subsections:

   ```markdown
   ## Approach

   ### What this PR does

   <plain-language walkthrough of the PR at a high level>

   ### Key Implementation Decisions

   <chosen implementation decisions and why they matter for review>
   ```

   Requirements for the whole `## Approach` section:
   - Always include both `### What this PR does` and `### Key Implementation Decisions`.
   - Keep implementation detail high-level enough that a reviewer can choose where to dive into the diff.
   - Mention tests only when they clarify behavior coverage or reviewer risk.

   Requirements for `### What this PR does`:
   - Explain the PR in simple language before naming implementation details.
   - Prefer an example, ASCII diagram, before/after flow, or short pseudocode when it makes the behavior easier to review.
   - Keep the walkthrough high-level: describe the user-visible or system-visible flow, not every file touched.
   - Focus on what changes for the caller, user, operator, or adjacent system.

   Requirements for `### Key Implementation Decisions`:
   - Write compact key implementation decisions, not a component inventory.
   - Organize decisions by review boundary, not by commit order.
   - For multi-subsystem PRs, prefer 3-5 decision blocks.
   - Prefer this shape for each decision:
     - `#### D<n>: <decision name>`
     - `**Chosen:** <what this PR does>.`
     - `**Why this matters for review:** <what reviewers should inspect and why>.`
   - Use small diagrams or pseudocode for contracts, validation paths, state transitions, and persistence behavior when they make the decision easier to review.
9. Leave every byte outside those two managed sections unchanged. Do not edit, reorder, remove, or regenerate any other section or content.
10. Then update the PR body with:

```bash
gh pr edit --repo "$repo" "$pr_url" --body-file "<body-file>"
```

**Focus on the high-level problem and approach**

- Skip mechanical details such as added unit tests, renamed variables, changed function arguments, or other implementation minutiae unless they are essential to understanding the design.
- The goal is to state the problem clearly and lay out the high-level approach so reviewers can review the PR efficiently.
- The output should help reviewers triage the diff. If the generated text reads like an abstract design summary, rewrite it around concrete review boundaries.

For a PR that changes a request flow, prefer this shape over a dense paragraph:

```markdown
## Problem

The worker currently builds an LLM "background task completed" prompt itself before calling the conversation API. That makes the worker own user-visible prompt wording and leaves the API without a clear place to use persisted task history when producing the final assistant response.

This PR moves that prompt construction and inference back behind an internal API boundary, so reviewers should focus on the worker-to-API contract and how persisted task history is read.

## Approach

### What this PR does

Replaces the worker -> router call that used to construct an LLM "background task completed" prompt client-side with a new internal endpoint that constructs it server-side and runs LLM inference over the persisted task history.

Old shape, where the worker fabricates the user-visible prompt:

```text
worker -> POST /api/v2/assistant/conversation/{id}
          body: {
            data: {
              attributes: {
                message: "Background task ... completed ...",
                profile: "background_worker",
                client_tools: []
              }
            }
          }
```

New shape, where the worker only names the task and the API builds the prompt:

```text
worker -> POST /internal/assistant/v1/conversation/{id}/process-task
          body: { "task_id": "assistant-task.123" }
```

### Key Implementation Decisions

#### D1: Worker reports task identity; API owns completion inference

**Chosen:** Replace the public conversation message call with an internal `process-task` request that passes only the task id.

**Why this matters for review:** This is the main ownership boundary. Review the request shape, auth boundary, and API-side prompt construction because the worker should report completion while the API owns conversation behavior.

#### D2: API validates persisted final task state before inference

**Chosen:** Run completion inference only after the API confirms the task's final update is already persisted in conversation history.

**Why this matters for review:** This prevents the LLM turn from running over incomplete task history. Review how task history is selected, how the final update is detected, and what happens when validation fails.

#### D3: Completion trigger is visible to the LLM but not persisted as user content

**Chosen:** Keep the final assistant response written through the API path while avoiding persistence of the synthetic "background task completed" trigger as a user message.

**Why this matters for review:** This is the key conversation state transition. Review that the LLM has enough context to answer, while ChatStore records the worker updates and assistant response without adding a fake user-authored message.
```
