---
name: code-implement-loop
description: "Trigger this skill when implementation should start: if Codex/Claude proposes a plan and the user says 'implement this', 'implement the proposed plan', 'implement it', or equivalent; or if the user explicitly invokes `code-implement-loop`. Accepted implementation input sources are: a Codex/Claude-proposed plan, a user-provided `.md` plan/design file, or user-provided inline implementation instructions."
---

# Code Implement Loop

## Overview

Implement a task in a deterministic sequence: plan intake (`.md` file or direct user instructions) -> TODO breakdown -> implementation (uncommitted) -> iterative review/fix loop -> conditional `commit-smart` when `in_dd_scope=true`. Keep the loop focused on unresolved reviewer findings from prior local review rounds and stop only on reviewer approval plus the required completion step for the current repo scope, or max-rounds blocked output.

## Hard Rules
- First, review the `# Global Rules` from your memory file and apply them before the skill-specific rules below.
- Never use destructive cleanup commands (`git reset --hard`, `git checkout -- .`, `git clean -fd`).
- Approval definition: `approval` means reviewer JSON reports `findings=[]` and `overall_correctness="patch is correct"`, never user confirmation.
- Autonomy rule: do not ask the user for approval or extra checkpoints during normal flow; only ask the user when blocked/stuck/failing.

## Workflow

### 1) Preflight

1. Resolve repo scope and enforce the strict coding preflight:
   - `eval "$("$HOME/dotfiles/scripts/coding-preflight.mjs")"`
   - The helper must provide: `inside_worktree`, `worktree_root`, `worktree_path`, `branch`, `repo`, `in_dd_scope`, `origin_branch_ref`, `origin_branch_exists`, `local_ahead_count`, `origin_ahead_count`.
   - If helper exits non-zero, stop and report blocked status with helper stderr.
2. `cd "$worktree_root"` so subsequent commands run from a stable repo root.

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
7. Do not broaden scope while implementing a TODO; keep the code change limited to what that TODO and the approved plan require.

Repo constraints:

- Prefer `:all` over `...` for directory-wide runs when applicable.
- Never use `bzl test --test_filter`.
- Never run multiple `bzl` commands in parallel.

### 5) Run the local-uncommitted review/fix loop

DO NOT COMMIT inside this step.

Run a bounded loop with at most 2 rounds. Each round executes Steps 5a-5e below.

#### 5a) Normalize Review Context

1. Normalize checkout context through the shared helper:
   - `eval "$("$HOME/dotfiles/scripts/git-context.sh")"`
   - The helper must provide: `inside_worktree`, `worktree_root`, `worktree_path`, `branch`, `repo`, `in_dd_scope`.
   - If helper exits non-zero, stop and report blocked status with helper stderr.
2. `cd "$worktree_root"` so review commands run from a stable root.

#### 5b) Assemble Reviewer Inputs

The reviewer sub-agent gathers the local uncommitted patch set itself. The orchestrator only resolves the implementation plan and supporting context.

1. Resolve `implementation_plan` from Step 2:
   - if the implementation input is a `.md` path, use the contents of that file
   - otherwise use the inline instruction text exactly as provided to the skill
2. Include the remaining review inputs:
   - unresolved findings ledger from prior passes
   - `worktree_root` from Step 5a (so the reviewer can `cd` there before gathering the patch set)

#### 5c) Run Reviewer

1. Render the exact reviewer prompt through the shared helper:
   ```bash
   rendered_prompt="$(
   node scripts/render_reviewer_prompt.mjs \
      --worktree-root "$worktree_root" \
      --implementation-plan "$implementation_plan" \
      --unresolved-findings-ledger "$unresolved_findings_ledger"
   )"
   ```
2. Do not hand-edit `rendered_prompt` after generation.
3. Launch a fresh reviewer sub-agent with `rendered_prompt` as the exact prompt.
4. The reviewer must return strict JSON only, matching the output schema embedded in `scripts/render_reviewer_prompt.mjs`, and evaluate the local uncommitted patch set against the implementation plan.

#### 5d) Validate Reviewer Output

1. Parse reviewer output as strict JSON with no markdown fences or extra prose.
2. Validate exactly against the `OUTPUT FORMAT` schema embedded in `scripts/render_reviewer_prompt.mjs`.
3. If output is malformed or schema-invalid, rerun the reviewer once with a schema reminder.
4. If still invalid, stop and report blocked status with the invalid payload summary and validator errors.

#### 5e) Review/Fix Loop Control

- If the reviewer output has `findings=[]` and `overall_correctness="patch is correct"`, stop the loop and proceed to the next step.
- If the reviewer output has `findings=[]` and `overall_correctness="patch is incorrect"`, rerun the review pass once for consistency; if still inconsistent, stop and report blocked status.
- If the reviewer output has findings, fix unresolved items only, prioritize by `priority` ascending (`0` -> `3`; unknown priority after known priorities), rerun targeted verification, update the unresolved findings ledger, and continue until approval or max rounds.
- If a review round returns blocked status, propagate that status without proceeding to commit.
- If not approved after `MAX_ROUNDS`, emit blocked status with unresolved findings and attempted fixes.

### 6) Completion After Approval

After the review loop returns approval (empty findings + correct patch verdict):

- If `in_dd_scope=true`, immediately invoke `commit-smart` to commit and push changes.
- If `in_dd_scope=false`, stop after reporting success and leave the approved changes uncommitted in the worktree.

Rules:

- Do not ask the user for additional confirmation before running `commit-smart` when `in_dd_scope=true`.
- Do not end the workflow as success until `commit-smart` has completed when `in_dd_scope=true`.
- If `commit-smart` fails in dd scope, report blocked status with the failure reason and attempted remediation.
- Outside dd scope, do not invoke `commit-smart`, do not create or update a PR, and report success once the reviewed patch is complete.

### 7) Return final status

Success format:

- In dd scope: `SUCCESS: Implementation complete | PR: {url}`
- Outside dd scope: `SUCCESS: Implementation complete | PR: none`

Blocked format:

`BLOCKED: Not approved after {MAX_ROUNDS} rounds | PR: {url} | Unresolved: {summary} | Attempts: {summary}`

or

`BLOCKED: commit-smart failed | PR: {url} | Error: {summary} | Attempts: {summary}`
