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
- Never resolve GitHub PR comments.
- Only address unresolved comments and threads when reviewer feedback is part of the task.
- Approval definition: `approval` means reviewer JSON reports `findings=[]` and `overall_correctness="patch is correct"`, never user confirmation.
- Autonomy rule: do not ask the user for approval or extra checkpoints during normal flow; only ask the user when blocked/stuck/failing.
- Plan adherence rule: implement the approved plan as written. Do not add extra refactors, abstractions, dependency plumbing, cleanup, or opportunistic improvements unless they are strictly required to complete that plan.
- Minimality rule: when the plan is underspecified, choose the smallest implementation that satisfies the plan instead of broadening scope.
- If you discover a requirement that materially changes the plan, stop and report the gap rather than silently expanding the implementation.

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

Before running any Step 4 `bzl` command:

1. Normalize checkout context through the shared helper:
   - `eval "$("$HOME/dotfiles/scripts/git-context.sh")"`
   - The helper must provide: `inside_worktree`, `worktree_root`, `worktree_path`, `branch`, `repo`, `in_dd_scope`.
   - If helper exits non-zero, stop and report blocked status with helper stderr.
2. `cd "$worktree_root"` so all Step 4 Bazel commands run from a stable repo root.

For each TODO:

1. Add or update tests first when practical (TDD bias).
2. Implement minimal changes for the target behavior.
3. If `.go`, `.py`, or `.proto` imports/deps changed, run:
   - `bzl run //:gazelle`
   - On Bazel disk-pressure failure:
     - if `in_dd_scope != true`, stop and surface the captured failure; do not run the cleanup helper or `bzl run //:dd-doctor`
     - otherwise launch a fresh disk-pressure recovery sub-agent
     - never use mini models for this sub-agent
     - if the sub-agent returns `RETRY:`, rerun the original `bzl` command once
     - if that single rerun still fails with disk-pressure signals, stop and surface the repeated disk-pressure failure for that command; do not delegate again for the same command
     - if the sub-agent returns `BLOCKED:`, stop and propagate that blocked status
4. Run targeted verification.
   - Apply the same single-delegation and single-rerun Bazel disk-pressure policy to any verification `bzl` command.
5. Keep changes scoped to the current TODO.
6. DO NOT COMMIT during implementation; keep all changes uncommitted for the review loop.
7. Do not broaden scope while implementing a TODO; keep the code change limited to what that TODO and the approved plan require.

Repo constraints:

- Prefer `:all` over `...` for directory-wide runs when applicable.
- Never use `bzl test --test_filter`.
- Never run multiple `bzl` commands in parallel.
- Never use `bzl clean` for Bazel disk-pressure recovery.

### 5) Run the PR-aware review/fix loop

DO NOT COMMIT inside this step.

**Review Scope Policy:**
- Use PR-aware review scope by default: review the full prospective PR delta from merge base to the current working tree, not only the latest local diff hunk.
- Re-review the full prospective PR delta each time the review loop runs. Do not narrow scope to only previously flagged hunks.
- Focus on correctness, regression, security, compatibility, performance, and tests. Do not block on pure style nits.

Run a bounded loop with at most 2 rounds. Each round executes Steps 5a-5d below.

#### 5a) Normalize Review Context

1. Normalize checkout context through the shared helper:
   - `eval "$("$HOME/dotfiles/scripts/git-context.sh")"`
   - The helper must provide: `inside_worktree`, `worktree_root`, `worktree_path`, `branch`, `repo`, `in_dd_scope`.
   - If helper exits non-zero, stop and report blocked status with helper stderr.
2. `cd "$worktree_root"` so review commands run from a stable root.
3. Resolve the review base branch:
   - `base_branch="$(gh pr list --repo "$repo" --head "$branch" --state open --json baseRefName --jq '.[0].baseRefName' 2>/dev/null || true)"`
   - If empty: `base_branch="$(gh repo view --repo "$repo" --json defaultBranchRef -q '.defaultBranchRef.name' 2>/dev/null || true)"`
   - If still empty: `base_branch=main`
4. Ensure the base ref exists locally:
   - `git fetch origin "$base_branch" --quiet` as best effort.
5. Compute merge base:
   - `merge_base="$(git merge-base HEAD "origin/$base_branch" 2>/dev/null || true)"`
   - If empty, stop and report explicit base-resolution failure.

#### 5b) Gather PR-Aware Review Inputs

1. Detect an open PR for the current branch when possible:
   - `pr_url="$(gh pr list --repo "$repo" --head "$branch" --state open --json url --jq '.[0].url' 2>/dev/null || true)"`
2. Gather unresolved review feedback when available:
   - default `unresolved_pr_feedback='[]'`
   - if `pr_url` exists, resolve `pr_number` and query unresolved, non-outdated review threads
3. Build the review context pack:
   - `review_diff=$(git diff --binary "$merge_base")`
   - `changed_files=$(git diff --name-status "$merge_base")`
   - current full contents of changed files from the working tree, truncated deterministically to the first 400 lines per file
   - verification outputs summary
   - unresolved findings ledger from prior passes
   - unresolved PR comments or threads

#### 5c) Run Reviewer

1. Use the canonical reviewer prompt file:
   - `references/reviewer-prompt-codex-cli.md`
2. Inject the following placeholders:
   - `{review_diff}`, `{changed_files}`, `{changed_file_context}`,
     `{task_goal}`, `{verification_summary}`,
     `{unresolved_findings_ledger}`, `{unresolved_pr_feedback}`
3. Launch a fresh reviewer sub-agent.
4. The reviewer must return strict JSON only, matching the schema in `references/reviewer-prompt-codex-cli.md`.

#### 5d) Validate Reviewer Output

1. Parse reviewer output as strict JSON with no markdown fences or extra prose.
2. Validate exactly against the `OUTPUT FORMAT` schema in `references/reviewer-prompt-codex-cli.md`.
3. If output is malformed or schema-invalid, rerun the reviewer once with a schema reminder.
4. If still invalid, stop and report blocked status with the invalid payload summary and validator errors.

#### 5e) Review/Fix Loop Control

- If the reviewer output has `findings=[]` and `overall_correctness="patch is correct"`, stop the loop and proceed to commit.
- If the reviewer output has `findings=[]` and `overall_correctness="patch is incorrect"`, rerun the review pass once for consistency; if still inconsistent, stop and report blocked status.
- If the reviewer output has findings, fix unresolved items only, prioritize by `priority` ascending (`0` -> `3`; unknown priority after known priorities), rerun targeted verification with the same single-delegation and single-rerun Bazel disk-pressure policy from Step 4, update the unresolved findings ledger, and continue until approval or max rounds.
- If a review round returns blocked status, propagate that status without proceeding to commit.
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
