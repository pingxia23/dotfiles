---
name: code-implement-loop
description: "Trigger this skill when implementation should start: if Codex/Claude proposes a plan and the user says 'implement this', 'implement the proposed plan', 'implement it', or equivalent; or if the user explicitly invokes `code-implement-loop`. Accepted implementation input sources are: a Codex/Claude-proposed plan, a user-provided `.md` plan/design file, or user-provided inline implementation instructions. In dd scope it runs uncommitted change review rounds, commits with `commit-smart`, requests Codex review, then delegates full-branch review to `full-branch-review` unless `--skip-full-branch-review` is supplied."
---

# Code Implement Loop

## Overview

Implement a task in a deterministic sequence: plan intake (`.md` file or direct user instructions) -> branch-scoped plan recording -> TODO breakdown -> implementation (uncommitted) -> uncommitted change review/fix loop -> conditional `commit-smart` when `in_dd_scope=true` -> Codex review request -> optional full-branch review through `full-branch-review`.

## Hard Rules

- First, review the `# Global Rules` from your memory file and apply them before the skill-specific rules below.
- Never use destructive cleanup commands (`git reset --hard`, `git checkout -- .`, `git clean -fd`).
- Approval definition: `approval` means the reviewer script returns `status="approved"`, never user confirmation.
- Stop and notify user whenever bzl command waits for OIDC device auth
- Autonomy rule: do not ask the user for approval or extra checkpoints during normal flow; only ask the user when blocked/stuck/failing.

## Implementation Discipline

Read the `# Implementation Discipline` section from `$HOME/dotfiles/claude-global.md`.

If the task writes or changes Python code, also read `$HOME/dotfiles/python-implementation-guide.md`.

These rules apply to **both initial implementation and review-fix rounds**.



## Shared Review Result Handling

Use this exact handling after the uncommitted change review execution returns. Its inputs are:

- `review_result`: the JSON string returned by the current review
- `review_plan_context`: the implementation-plan context for the current review
- `current_round`: the current review round number, starting at 1
- `max_rounds`: 3 for uncommitted change review

### Parse Reviewer Output

1. Parse `review_result` as strict JSON with no markdown fences or extra prose.
2. The JSON must have:
   - `status`: `approved`, `revise`, or `blocked`
   - `findings`: actionable findings to fix, if any; each finding must follow the shared review schema, including concrete `evidence`
   - `overall_explanation`: short status explanation
3. If `review_result` is not valid JSON or does not include these fields, stop and report blocked status with the raw output summary.

### Filter Reviewer Findings

Before applying loop control, filter the parsed findings against `review_plan_context`:

1. Discard every finding below P2. These findings are never actionable.
2. For each P2 finding, regardless of reviewer, retain it only when its evidence shows that it is directly related to the plan context. A P2 finding is directly related when it identifies a defect introduced or modified by a planned implementation, missing behavior or verification explicitly required by a plan, a regression directly caused by a planned change, or a concrete and meaningful quality problem introduced or modified by a planned implementation. Quality problems may include naming, typing, imports, dependencies, module structure, data flow, error handling, test structure, fixtures, or mocks; they do not need to be runtime defects.
3. Treat pre-existing issues in unchanged behavior, adjacent cleanup, broader recommendations, and follow-up work outside the plan context as unrelated. Ignore these P2-or-lower comments: do not fix, record, publish, or use them to determine review status.
4. Do not discard a P0 or P1 finding.
5. If `status="revise"` becomes empty only because this filter removed findings, normalize the result to `status="approved"` before applying loop control. A reviewer result that originally returned `status="revise"` with no findings remains blocked as described below.
6. Replace `review_result` with strict JSON containing the retained `findings`, normalized `status`, and an `overall_explanation` that describes only the remaining findings and status. Use `review_result` afterward.

### Review/Fix Loop Control

- If `status="approved"`, stop the current review loop and continue with the next workflow step.
- If `status="blocked"`, propagate that status without proceeding to commit.
- If `status="revise"` and `findings` is empty, stop and report blocked status with the aggregate output because there is no actionable finding to fix.
- If `status="revise"` has findings and `current_round < max_rounds`, fix those items only, prioritize by `priority` ascending (`0` -> `3`; unknown priority after known priorities), rerun targeted verification, and continue to the next review round.
- If `status="revise"` has findings and `current_round >= max_rounds`, record the current findings and attempted fixes, stop the current review loop, continue to the next workflow step without blocking, and include the recorded findings and attempts in the final status.
- Only retained P0-P2 findings are actionable. Sub-P2 comments, unrelated P2 comments, nits, praise, and broad suggestions must be omitted from `findings` and must not force `status="revise"`.
- Apply these rules to every review result before loop control.

## Workflow

### 1) Preflight

1. Resolve repo scope and enforce the strict coding preflight:
   - `eval "$("$HOME/dotfiles/scripts/coding-preflight.mjs")"`
   - The helper must provide: `inside_worktree`, `worktree_root`, `worktree_path`, `branch`, `repo`, `in_dd_scope`, `origin_branch_ref`, `origin_branch_exists`, `local_ahead_count`, `origin_ahead_count`.
   - If helper exits non-zero, stop and report blocked status with helper stderr.
2. `cd "$worktree_root"` so subsequent commands run from a stable repo root.

### 2) Input contract

Accept the optional `--skip-full-branch-review` control flag before the implementation source. Set `skip_full_branch_review=true` when it is present. Otherwise, set `skip_full_branch_review=false`.

Accept one of the following as the implementation source:

1. **`.md` file path** — a path to a plan/design document.
2. **Direct user instructions** — inline text describing the changes to implement.

Resolution order:

- Remove the leading `--skip-full-branch-review` control flag before resolving the implementation source. Do not include the flag in `implementation_plan` or the recorded plan history.
- Reject any other leading flag as `FAILED: unsupported flag: <flag>`.
- If the remaining input is completely empty (no file path and no instructions), stop and return:
  - `FAILED: provide a .md plan file or describe the changes to implement`
- If the remaining argument is a path ending in `.md`, set `implementation_plan` to the contents of that file.
- Otherwise, set `implementation_plan` to the inline instruction text exactly as provided to the skill.
- Do not run explore-intent in this skill.

After resolving `implementation_plan`, persist it before creating TODOs:

```bash
if ! node "$HOME/dotfiles/claude-skills/code-implement-loop/scripts/implementation_plan_history.mjs" record \
  --worktree-root "$worktree_root" \
  --branch "$branch" \
  --implementation-plan "$implementation_plan" >/dev/null; then
  echo "BLOCKED: failed to record implementation plan"
  exit 1
fi
```

The helper stores two Markdown files under `<git-common-dir>/code-implement-loop/plans/<URL-encoded-branch>/`: an append-only `committed_plan_history.md` and an atomically replaced `pending_implementation_plan.md`. Starting a new implementation replaces any existing pending plan. Both files remain outside the working tree and must not be added to the implementation diff. If the helper fails, stop and report blocked status.

### 3) Create decision-complete TODOs

Before creating implementation TODOs:

- If running as Claude, read `CLAUDE.md`.
- Otherwise, read `AGENTS.md`.

Build an ordered TODO checklist before editing code.

- Use the resolved `implementation_plan` from Step 2 as the implementation source.
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

### 5) Run The Uncommitted Change Review/Fix Loop

DO NOT COMMIT inside this step.

Run a bounded loop with at most **3** rounds. Each round executes Steps 5a-5d below.

#### 5a) Normalize Review Context

1. Normalize checkout context through the shared helper:
   - `eval "$("$HOME/dotfiles/scripts/git-context.sh")"`
   - The helper must provide: `inside_worktree`, `worktree_root`, `worktree_path`, `branch`, `repo`, `in_dd_scope`.
   - If helper exits non-zero, stop and report blocked status with helper stderr.
2. `cd "$worktree_root"` so review commands run from a stable root.

#### 5b) Assemble Reviewer Inputs

The reviewer script gathers and evaluates the local uncommitted patch set itself. The orchestrator only passes the already-resolved implementation plan and supporting context.

1. Use `implementation_plan` exactly as resolved in Step 2.
2. Include `worktree_root` from Step 5a so the reviewer script can `cd` there before gathering the patch set.

#### 5c) Run Reviewer Script

1. Run the reviewer script:
   ```bash
   review_result="$(
   node "$HOME/dotfiles/scripts/code-review/run_dual_patch_review.mjs" \
      --worktree-root "$worktree_root" \
      --implementation-plan "$implementation_plan"
   )"
   ```
2. Do not hand-edit `review_result`.

#### 5d) Handle Reviewer Result

Apply **Shared Review Result Handling** with:

- `review_result="$review_result"`
- `review_plan_context="$implementation_plan"`
- `current_round`: the current uncommitted change review round number
- `max_rounds=3`

### 6) Commit After Uncommitted Change Review

After the uncommitted change review loop returns approval, or reaches 3 rounds with `status="revise"` and actionable findings:

- If `in_dd_scope=false`, stop after reporting success and leave the reviewed changes uncommitted in the worktree.
- Otherwise, immediately invoke `commit-smart` to commit and push changes.

After `commit-smart` succeeds, or after the user confirms that they committed the implementation manually, finalize the pending plan against the resulting commit:

```bash
if ! node "$HOME/dotfiles/claude-skills/code-implement-loop/scripts/implementation_plan_history.mjs" finalize \
  --worktree-root "$worktree_root" \
  --branch "$branch"; then
  echo "BLOCKED: failed to finalize committed implementation plan"
  exit 1
fi
```

The helper resolves the current branch's pending and committed-history files, reads the local `HEAD`, appends the pending plan to the committed history, and removes the pending file. The skill must not reproduce those steps.

Rules:

- Do not ask the user for additional confirmation before running `commit-smart` when `in_dd_scope=true`.
- Do not proceed to the next step until `commit-smart` has completed when `in_dd_scope=true`.
- If `commit-smart` fails in dd scope and no manual commit was completed, report blocked status with the failure reason and attempted remediation. Preserve the pending plan for recovery.
- If finalizing the pending plan fails, report blocked status and do not start full branch review because the current plan would be missing from its intent context.
- Outside dd scope, do not invoke `commit-smart`, do not create or update a PR, and report success once the reviewed patch is complete.

### 7) Request Codex review

Run this step when `skip_full_branch_review=true`. The flag controls only Step 8.

Post `@codex review` as a top-level PR comment:

```bash
repo_owner="${repo%%/*}"
if [[ "$repo_owner" == "ddoghq" ]]; then
  gh_function="gh-ddog"
else
  gh_function="gh-personal"
fi
zsh -ic 'source "$HOME/dotfiles/zshrc"; "$@"' \
  code-review-gh "$gh_function" pr comment --repo "$repo" "$pr_url" \
    --body "@codex review"
```

If the comment fails to post, carry the failure into the final status but continue to Step 8.

### 8) Run Full Branch Review In DD Scope

If `skip_full_branch_review=true`, do not invoke `full-branch-review`. Continue directly to Step 9.

Otherwise, invoke the `full-branch-review` skill without `--skip-pr-comment` and wait for it to finish.

Always continue to Step 9 after it returns. If the skill invocation fails or reports blocked status, save its exact error summary in `full_branch_review_error` for the final status. Do not retry or otherwise act on its result in this workflow.

### 9) Return final status

Success format:

- In dd scope: `SUCCESS: Implementation complete, uncommitted change review completed, full branch review attempted | PR: {url}`
- In dd scope with `skip_full_branch_review=true`: `SUCCESS: Implementation complete, uncommitted change review completed, full branch review skipped | PR: {url}`
- Outside dd scope: `SUCCESS: Implementation complete, uncommitted change review completed | PR: none`
- If the uncommitted change review continued after 3 rounds without approval, append: `| Uncommitted change findings: {summary} | Attempts: {summary}`
- If the Codex review comment failed to post in Step 7, append: `| Warning: failed to request Codex review: {exact error summary}`
- If `full_branch_review_error` is non-empty, append: `| Warning: full branch review failed: {exact error summary}`

Blocked format:

`BLOCKED: commit-smart failed | PR: {url} | Error: {summary} | Attempts: {summary}`
