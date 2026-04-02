---
name: code-implement-loop
description: "Trigger this skill when implementation should start: if Codex/Claude proposes a plan and the user says 'implement this', 'implement the proposed plan', 'implement it', or equivalent; or if the user explicitly invokes `code-implement-loop`. Accepted implementation input sources are: a Codex/Claude-proposed plan, a user-provided `.md` plan/design file, or user-provided inline implementation instructions."
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
- Approval definition: `approval` means reviewer JSON reports `findings=[]` and `overall_correctness="patch is correct"`, never user confirmation.
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

### 5) Run the PR-aware review/fix loop with `code-review`

Use the dedicated `code-review` skill as the single source of truth for each PR-aware review pass.
DO NOT COMMIT inside this step.

Contract:

- Run a bounded loop with at most 2 rounds.
- Delegate each review round to `code-review` in delegated mode.
- Pass the current task goal, targeted verification summary, and any unresolved findings ledger from prior rounds.
- `code-review` owns:
  - PR-aware base/head resolution
  - merge-base computation
  - unresolved PR feedback ingestion
  - full-delta re-review policy for each invocation
  - reviewer prompt selection and schema validation
- The loop in this skill owns:
  - approval evaluation
  - retry behavior and round counting
  - fix application
  - targeted verification reruns
  - re-invocation after fixes
- Treat delegated `code-review` output as the round result.
- If delegated `code-review` output has `findings=[]` and `overall_correctness="patch is correct"`, stop the loop and proceed to commit.
- If delegated `code-review` output has `findings=[]` and `overall_correctness="patch is incorrect"`, rerun the review pass once for consistency; if still inconsistent, stop and report blocked status.
- If delegated `code-review` output has findings, fix unresolved items only, prioritize by `priority` ascending (`0` -> `3`; unknown priority after known priorities), rerun targeted verification, update the unresolved findings ledger, and continue until approval or max rounds.
- If `code-review` returns blocked status, propagate that status without proceeding to commit.
- If not approved after `MAX_ROUNDS`, emit blocked status with unresolved findings and attempted fixes.

### 6) Mandatory commit-smart after approval

After the review loop returns approval (empty findings + correct patch verdict), immediately invoke `commit-smart` to commit and push changes.

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
