---
name: pr-body
description: "Create or update the managed GitHub PR body for a PR URL. Use when a workflow needs to initialize or refresh the managed TL;DR, Problem, Approach, and optional Dev Test sections on an existing PR."
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
3. Locate section headings that start with `## `. Each section ends at the next such heading or at the end of the body. When updating a managed section, replace its full content.
4. Generate new content only for the managed `## TL;DR`, `## Problem`, `## Approach`, and optional `## Dev Test` sections, using the PR title, managed body, commit list, changed files, full PR diff, and available execution records for Rapid test drives (`rapid td` commands) or Hotdog deployments made with `hotdog-deploy` from the conversation or command output.
   - Before drafting these sections, read the `## Writing Style` section from your memory file and apply it to the generated prose.
   - Assume the reviewer understands software engineering fundamentals but has no prior knowledge of the repository or its internal terminology.
   - Write for a reviewer who is deciding what to inspect first.
   - Prefer concrete review areas over broad architecture phrasing.
   - Do not compress multiple subsystems into one long sentence.
   - Do not enumerate every touched file, test, or mechanical edit.
   - Skip mechanical details such as added unit tests, renamed variables, or changed function arguments unless they are essential to understanding the design.
   - If the PR spans multiple subsystems, use short bullets grouped by review boundary.
5. Upsert the `## TL;DR` section:
   - If a line exactly matching `## TL;DR` exists, replace that full section. The section starts at `## TL;DR` and ends immediately before the next `## ` heading, or at end of body.
   - If it does not exist, create a new `## TL;DR` section after the marker and any immediately following blank lines.
6. Upsert the `## Problem` section:
   - If a line exactly matching `## Problem` exists, replace that full section. The section starts at `## Problem` and ends immediately before the next `## ` heading, or at end of body.
   - Otherwise, if a line exactly matching the legacy heading `## Context` exists, replace that full section with `## Problem` and its generated content.
   - If neither heading exists, create a new `## Problem` section immediately after the `## TL;DR` section.
7. Upsert the `## Approach` section:
   - If a line exactly matching `## Approach` exists, replace that full section. The section starts at `## Approach` and ends immediately before the next `## ` heading, or at end of body.
   - If it does not exist, create a new `## Approach` section immediately after the `## Problem` section.
8. The `## TL;DR` section must give the reviewer a fast, plain-language summary:

   ```markdown
   ## TL;DR

   <observable behavior change and why it matters>
   ```

   Requirements:
   - State the main behavior change and its value in no more than three sentences.
   - Name an important scope boundary when it prevents the reviewer from assuming the PR does more than it does.
   - Do not include implementation details, review guidance, or a list of changed files.
9. The `## Problem` section must be concise and reviewer-digestible:

   ```markdown
   ## Problem

   <why this change is needed>
   ```

   Requirements:
   - State the current limitation or missing capability in plain language.
   - State the concrete user or system impact of that limitation.
   - Describe only why the change is needed. Put the solution, implementation, and review guidance in `## Approach`.
   - Do not use solution-led sentences such as "This PR adds," "This PR moves," or "This PR introduces."
   - Use no more than five sentences in total.
   - Avoid umbrella phrases like "end-to-end path" unless the following text names the concrete boundaries.
10. The `## Approach` section must be concise, reviewer-digestible, and organized into a walkthrough followed by folded implementation decisions:

   ```markdown
   ## Approach

   ### What this PR does

   <plain-language walkthrough of the PR at a high level>

   <details>
   <summary><strong>Key Implementation Decisions</strong></summary>

   <chosen implementation decisions>
   </details>
   ```

   Requirements for the whole `## Approach` section:
   - Always include both `### What this PR does` and the `Key Implementation Decisions` `<details>` block.
   - Leave the `<details>` tag without the `open` attribute so GitHub folds the decisions by default.
   - Keep implementation detail high-level enough that a reviewer can choose where to dive into the diff.
   - Mention tests only when they clarify behavior coverage or reviewer risk.

   Requirements for `### What this PR does`:
   - Start with the observable before/after behavior, then name the components that implement it.
   - Define each repository-specific or domain-specific term when it first appears. A code identifier is not a definition.
   - Prefer an example, ASCII diagram, before/after flow, or short pseudocode when it makes the behavior easier to review.
   - Keep the walkthrough high-level: describe the user-visible or system-visible flow, not every file touched.
   - Focus on what changes for the caller, user, operator, or adjacent system.

   Requirements for `### Key Implementation Decisions`:
   - Write compact key implementation decisions, not a component inventory.
   - Organize decisions for review, not by commit order.
   - For multi-subsystem PRs, prefer 2-4 decision blocks.
   - Prefer this shape for each decision:
     - `#### D<n>: <decision name>`
     - `**Chosen:** <what this PR does>.`
   - Use small diagrams or pseudocode for contracts, validation paths, state transitions, and persistence behavior when they make the decision easier to review.
11. Include `## Dev Test` only when execution records show that a Rapid test drive (`rapid td` commands) was run or a Hotdog deployment was made with `hotdog-deploy` for this PR. When included, keep it as the last section of the body.

   **What counts as a dev test**

   Only these actions qualify:

   - A Rapid test drive run through `rapid td` commands.
   - A Hotdog deployment made with `hotdog-deploy`, including any checks performed against that deployment.



   **What to record**

   Record direct links to telemetry from the qualifying dev test, such as an LLM Observability trace (a record of the language model's execution). Give each link a short label identifying the tested scenario and the type of telemetry. The section should contain telemetry links, not commands, deployment instructions, or expected-versus-observed result summaries.

   ```markdown
   ## Dev Test

   - [<tested scenario> — LLM Observability trace](<actual telemetry URL from the dev test>)
   ```

   Use telemetry URLs from the conversation, command output, or retrieved telemetry records. Each link must belong to the qualifying dev test. Do not invent URLs, link unrelated runs, or use a generic telemetry landing page.

   Keep previous telemetry links only if they meet these rules. Remove other entries and duplicate links.

   If no qualifying actions are recorded, omit the entire `## Dev Test` section. Remove any existing managed `## Dev Test` section, including its heading and content. Do not add an empty section or a placeholder explaining that no dev test was run.
   If a qualifying dev test ran but no telemetry link is available, omit the section until a link is available.
12. Apply the readability check before updating the PR:
   - Read only the generated TL;DR, Problem, Approach, and Dev Test (when included) as an engineer who is new to the repository.
   - Confirm the reader can explain what happens today, why it is a problem, what behavior changes, and which parts need careful review.
   - Confirm every internal term needed to understand the change is defined before it is used.
   - Confirm each paragraph has one main purpose and does not stack unrelated subsystems or unfamiliar terms.
   - Rewrite the sections if any check fails.
13. Leave every byte outside those managed sections (and the legacy `## Context` section when migrated) unchanged, except for the blank-line separator needed when appending `## Dev Test`. Do not edit, reorder, remove, or regenerate any other section or content.
14. Then update the PR body with:

```bash
gh pr edit --repo "$repo" "$pr_url" --body-file "<body-file>"
```
