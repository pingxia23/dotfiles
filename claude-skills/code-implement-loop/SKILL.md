---
name: code-implement-loop
description: Implement code changes strictly from a user-provided `.md` plan/design file. Use when asked to make code changes or implement a feature from an explicit plan document.
---

# Code Implement Loop

## Overview

Implement a task in a deterministic sequence: strict `.md` plan intake -> TODO breakdown -> implementation (uncommitted) -> iterative review/fix loop -> single commit-smart. Keep the loop focused on unresolved feedback and stop only on approval or max-rounds blocked output.

## Workflow

### 1) Apply hard rules

- Never change the current git branch name.
- Use `gh` for all GitHub interactions.
- Address unresolved PR comments/findings only.
- Never use destructive cleanup commands (`git reset --hard`, `git checkout -- .`, `git clean -fd`).

### 2) Input contract (strict)

- Require exactly one `.md` plan/design path as input.
- If input is missing or not a `.md` file, stop and return:
  - `FAILED: plan/design .md file is required`
- Use the provided `.md` file as the only implementation source.
- Do not run explore-intent in this skill.


### 3) Create decision-complete TODOs
Before creating implementation TODOs:
  - If running as Claude, read `CLAUDE.md`.
  - Otherwise, read `AGENTS.md`.

Build an ordered TODO checklist before editing code.

- Include exact files to change.
- Include tests to add/update for each TODO.
- Include verification command per TODO.
- Include dependency order between TODOs.
- Resolve missing decisions before coding.

### 4) Implement TODOs in order

For each TODO:

1. Add or update tests first when practical (TDD bias).
2. Implement minimal changes for the target behavior.
3. If `.go`, `.py`, or `.proto` imports/deps changed, run:
   - `bzl run //:gazelle`
4. Run targeted verification.
5. Keep changes scoped to the current TODO.
6. DO NOT COMMIT during implementation; keep all changes uncommitted for the review loop.

Repo constraints:

- Prefer `:all` over `...` for directory-wide runs when applicable.
- Never use `bzl test --test_filter`.
- Never run multiple `bzl` commands in parallel.

### 5) Run Ralph Wiggum review/fix loop

Run a bounded loop with at most 5 rounds.
Each round must use a new reviewer sub-agent (fresh context).
DO NOT COMMIT inside this loop.

Defaults:

- `MAX_ROUNDS = 5`
- completion token: `<promise>IMPLEMENTATION_COMPLETE</promise>`

Fixed reviewer prompt:

```text
You are a fresh reviewer in a Ralph Wiggum implementation loop.

Review inputs:
- Working tree diff (from `git diff`): {working_diff}
- Goal: {task_goal}
- Previously unresolved findings ledger: {unresolved_findings_ledger}

Return only:
- APPROVED
or
- NEEDS_CHANGES with prioritized unresolved items (critical -> minor). For each item include:
  - finding_id
  - severity
  - file:line
  - issue
  - concrete fix recommendation

Rules:
- report unresolved issues only from the current working-tree state
- do not repeat resolved findings from prior rounds
- keep feedback actionable and specific
- if there are no unresolved issues, return APPROVED
```

Per round:

1. Capture current uncommitted diff for this round:
   - `working_diff=$(git diff)`
2. Launch a new reviewer sub-agent with fresh context:
   - Review inputs must include:
     - `working_diff`
     - task goal
     - unresolved findings ledger
   - The sub-agent model must use the same model as the main agent.
3. If `APPROVED`, emit `<promise>IMPLEMENTATION_COMPLETE</promise>` and stop.
4. If `NEEDS_CHANGES`:
   - fix unresolved items only,
   - rerun verification,
   - keep changes uncommitted for the next round.
5. If not approved after `MAX_ROUNDS`, emit blocked status with unresolved list and attempted fixes.

### 6) Commit once after approval with commit-smart

After the review loop returns `APPROVED`, invoke `commit-smart` to commit and push changes.

### 7) Return final status

Success format:

`SUCCESS: Implementation complete | PR: {url}`

Blocked format:

`BLOCKED: Not approved after {MAX_ROUNDS} rounds | PR: {url} | Unresolved: {summary} | Attempts: {summary}`
