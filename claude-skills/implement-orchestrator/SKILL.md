---
name: implement-orchestrator
description: Orchestrate implementation from a planning outcome by routing narrow, decision-complete plans directly to the `code-implement-loop` skill, and routing large or ambiguous plans through a persisted implementation document at `designs/{slug}/IMPLEMENTATION.md` followed by milestone-by-milestone sub-agent execution. Use when a user provides a plan and asks for automatic implementation routing and staged delivery.
---

# Implement Orchestrator

## Overview

Implement a planning-to-implementation router:
- Route narrow plans directly to `code-implement-loop`.
- Route large or ambiguous plans through `designs/{slug}/IMPLEMENTATION.md`, then execute milestones sequentially with fresh sub-agents that each use `code-implement-loop`.

## Hard Rules

- Never change the current git branch name.
- Use `gh` for all GitHub interactions.
- If running in a git worktree, resolve and pin the GitHub repository explicitly:
  - run `gh repo view --json nameWithOwner -q .nameWithOwner` from the current worktree,
  - pass `--repo <owner/repo>` to subsequent `gh` commands.
- Address unresolved PR comments/findings only.
- Never use destructive cleanup commands (`git reset --hard`, `git checkout -- .`, `git clean -fd`).
- Preserve existing unrelated working tree changes.

## Input Contract

Accept one of:
1. Path to a markdown plan file.
2. Direct pasted planning outcome text (for example a `<proposed_plan>` block).

Normalization rules:
- If the user says `code-implementation-loop`, normalize to `code-implement-loop`.
- If input is missing, stop and return:
  - `FAILED: provide a planning outcome (markdown path or pasted plan text)`

## Workflow

### 1) Intake and parse planning outcome

- Read the plan source and extract:
  - goal summary
  - milestones
  - explicit file paths (if present)
  - unresolved placeholders/questions
  - verification commands

### 2) Route plan scope

- Apply `references/routing-rubric.md`.
- Emit exactly one route token:
  - `ROUTE: narrow`
  - `ROUTE: large`
- Include concise rationale for the chosen route.

### 3) Narrow route behavior

If route is `narrow`:
1. Hand off the original plan source directly to the `code-implement-loop` skill.
2. Do not generate an implementation doc.
3. Return final status from `code-implement-loop`.

### 4) Large route behavior

If route is `large`:
1. Derive slug from plan title (kebab-case).
2. Create `designs/{slug}/IMPLEMENTATION.md`.
3. Fill the document using `references/implementation-doc-template.md`.
4. Ensure the roadmap satisfies:
   - Milestone 1 is always `Integration Tests`.
   - Each milestone is independently verifiable.
   - Milestones are dependency-ordered.
   - Verification command and expected result are present for each milestone.
5. Ensure `## Validation and Acceptance` is present as a final end-to-end gate after all milestones, not a milestone itself.

### 5) Execute large-route milestones

For each milestone in `designs/{slug}/IMPLEMENTATION.md`, in order:
1. Launch a fresh sub-agent.
2. Use milestone prompt from `references/subagent-prompts.md`.
3. Instruct sub-agent to implement only that milestone via the `code-implement-loop` skill.
4. Enforce commit boundary per milestone:
   - capture `base_sha=$(git rev-parse HEAD)` before launch,
   - after success capture `head_sha=$(git rev-parse HEAD)`,
   - require exactly one new commit: `git rev-list --count ${base_sha}..${head_sha}` equals `1`.
5. Wait for sub-agent completion and commit-boundary validation before continuing.
6. Stop immediately if a milestone is blocked or commit-boundary validation fails.

### 6) Final status contract

Success:
- `SUCCESS: Implemented via {route} route | Doc: {doc_path_or_none} | Milestones: {summary}`

Blocked:
- `BLOCKED: route={route} | Milestone: {name_or_none} | Reason: {summary}`

Failed input/parse:
- `FAILED: {reason}`

## Reference Files

- `references/routing-rubric.md`
- `references/implementation-doc-template.md`
- `references/subagent-prompts.md`
