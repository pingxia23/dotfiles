---
name: code-implement-loop
description: Implement code changes from a user-provided `.md` plan/design file or direct user instructions. Use when asked to make code changes, implement a feature from an explicit plan document, or implement changes described inline.
---

# Code Implement Loop

## Overview

Implement a task in a deterministic sequence: plan intake (`.md` file or direct user instructions) -> TODO breakdown -> implementation (uncommitted) -> iterative review/fix loop -> mandatory single commit-smart. Keep the loop focused on unresolved feedback and stop only on reviewer approval + commit-smart completion, or max-rounds blocked output.

## Workflow

### 1) Apply hard rules

- Never change the current git branch name.
- Use `gh` for all GitHub interactions.
- Address unresolved PR comments/findings only.
- Never use destructive cleanup commands (`git reset --hard`, `git checkout -- .`, `git clean -fd`).
- Approval definition: `approval` means `APPROVED` from the Ralph reviewer sub-agent loop, never user confirmation.
- Autonomy rule: do not ask the user for approval or extra checkpoints during normal flow; only ask the user when blocked/stuck/failing.

### 2) Input contract

Accept one of the following as the implementation source:

1. **`.md` file path** — a path to a plan/design document.
2. **Direct user instructions** — inline text describing the changes to implement.

Resolution order:

- If the argument is a path ending in `.md`, use that file as the implementation source.
- Otherwise, treat the entire user input as direct implementation instructions.
- If input is completely empty (no file path and no instructions), stop and return:
  - `FAILED: provide a .md plan file or describe the changes to implement`
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
3. If `APPROVED` (reviewer sub-agent status, not user approval), emit `<promise>IMPLEMENTATION_COMPLETE</promise>` and stop.
4. If `NEEDS_CHANGES`:
   - fix unresolved items only,
   - rerun verification,
   - keep changes uncommitted for the next round.
5. If not approved after `MAX_ROUNDS`, emit blocked status with unresolved list and attempted fixes.

### 6) Mandatory commit-smart after approval

After the review loop returns `APPROVED`, immediately invoke `commit-smart` to commit and push changes.

Rules:
- Do not ask the user for additional confirmation before running `commit-smart`.
- Do not end the workflow as success until `commit-smart` has completed.
- If `commit-smart` fails, report blocked status with the failure reason and attempted remediation.

### 7) Return final status

Success format:

`SUCCESS: Implementation complete | PR: {url}`

Blocked format:

`BLOCKED: Not approved after {MAX_ROUNDS} rounds | PR: {url} | Unresolved: {summary} | Attempts: {summary}`

or

`BLOCKED: commit-smart failed | PR: {url} | Error: {summary} | Attempts: {summary}`
