---
name: code-implement-loop
description: Implement code changes strictly from a user-provided `.md` plan/design file. Use when asked to make code changes or implement a feature from an explicit plan document.
---

# Code Implement Loop

## Overview

Implement a task in a deterministic sequence: strict `.md` plan intake -> TODO breakdown -> implementation -> commit-smart -> iterative review/fix loop. Keep the loop focused on unresolved feedback and stop only on approval or max-rounds blocked output.

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
- Do not run research in this skill.


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

Repo constraints:

- Prefer `:all` over `...` for directory-wide runs when applicable.
- Never use `bzl test --test_filter`.
- Never run multiple `bzl` commands in parallel.

### 5) Commit with commit-smart

When implementation changes are ready, invoke `commit-smart` to:

- run affected tests,
- stage changes with exclusions,
- commit with hooks enabled,
- push,
- create or update PR.

### 6) Run Ralph Wiggum review/fix loop

Run a bounded loop with at most 5 rounds.
Each round must use a new reviewer sub-agent (fresh context).

Defaults:

- `MAX_ROUNDS = 5`
- completion token: `<promise>IMPLEMENTATION_COMPLETE</promise>`

Fixed reviewer prompt:

```text
You are a fresh reviewer in a Ralph Wiggum implementation loop.

Review inputs:
- PR URL: {pr_url}
- PR diff (from `gh pr diff`): {pr_diff}
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
- report unresolved issues only from the current PR state
- do not repeat resolved findings from prior rounds
- keep feedback actionable and specific
- if there are no unresolved issues, return APPROVED
```

Per round:

1. Resolve PR link for this round:
   - `pr_url=$(gh pr view --json url -q '.url')`
2. Launch a new reviewer sub-agent with fresh context:
   - Review inputs must include:
     - `pr_url`
     - `gh pr diff`
     - task goal
     - unresolved findings ledger
3. If `APPROVED`, emit `<promise>IMPLEMENTATION_COMPLETE</promise>` and stop.
4. If `NEEDS_CHANGES`:
   - fix unresolved items only,
   - rerun verification,
   - run `commit-smart` to commit/push round changes,
   - update PR/comments describing what was addressed.
5. If not approved after `MAX_ROUNDS`, emit blocked status with unresolved list and attempted fixes.

### 7) Return final status

Success format:

`SUCCESS: Implementation complete | Commit: {hash} | PR: {url} | Review rounds: {n} | <promise>IMPLEMENTATION_COMPLETE</promise>`

Blocked format:

`BLOCKED: Not approved after {MAX_ROUNDS} rounds | PR: {url} | Unresolved: {summary} | Attempts: {summary}`
