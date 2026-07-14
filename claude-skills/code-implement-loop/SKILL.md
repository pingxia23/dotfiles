---
name: code-implement-loop
description: "Trigger this skill when implementation should start: if Codex/Claude proposes a plan and the user says 'implement this', 'implement the proposed plan', 'implement it', or equivalent; or if the user explicitly invokes `code-implement-loop`. Accepted implementation input sources are: a Codex/Claude-proposed plan, a user-provided `.md` plan/design file, or user-provided inline implementation instructions. In dd scope it runs uncommitted change review rounds, commits with `commit-smart`, runs up to 2 full branch review rounds, commits review fixes, publishes any remaining full-branch findings in a PR comment, then requests Codex review."
---

# Code Implement Loop

## Overview

Implement a task in a deterministic sequence: plan intake (`.md` file or direct user instructions) -> TODO breakdown -> implementation (uncommitted) -> uncommitted change review/fix loop -> conditional `commit-smart` when `in_dd_scope=true` -> full branch review/fix loop in dd scope -> conditional second `commit-smart` for review fixes -> conditional PR comment for unaddressed full-branch findings -> Codex review request. The first review loop evaluates only the current uncommitted patch. The second review loop evaluates the full local diff, including existing branch commits and any current uncommitted review fixes, against the fetched PR base.

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

Use this exact handling for both review loops after the loop-specific reviewer script returns. The only loop-specific inputs are:

- `review_result`: the raw JSON string returned by the reviewer script
- `current_round`: the current review round number, starting at 1
- `max_rounds`: 3 for uncommitted change review, 2 for full branch review

### Parse Reviewer Output

1. Parse `review_result` as strict JSON with no markdown fences or extra prose.
2. The JSON must have:
   - `status`: `approved`, `revise`, or `blocked`
   - `findings`: actionable findings to fix, if any; each finding must follow the shared review schema, including concrete `evidence`
   - `overall_explanation`: short status explanation
3. If `review_result` is not valid JSON or does not include these fields, stop and report blocked status with the raw output summary.

### Review/Fix Loop Control

- If `status="approved"`, stop the current review loop and continue with the next workflow step.
- If `status="blocked"`, propagate that status without proceeding to commit.
- If `status="revise"` and `findings` is empty, stop and report blocked status with the aggregate output because there is no actionable finding to fix.
- If `status="revise"` has findings and `current_round < max_rounds`, fix those items only, prioritize by `priority` ascending (`0` -> `3`; unknown priority after known priorities), rerun targeted verification, and continue to the next review round.
- If `status="revise"` has findings and `current_round >= max_rounds`, record the current findings and attempted fixes, stop the current review loop, continue to the next workflow step without blocking, and include the recorded findings and attempts in the final status.
- Only P0-P2 findings are actionable. Sub-P2 comments, nits, praise, and broad suggestions must be omitted from `findings` and must not force `status="revise"`.
- Both review loops use the same structured runner and schema after prompt/context assembly. The prompts require an internal scout pass, applicable specialist review lenses, mandatory evidence per finding, and a self-challenge pass before output.

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

- If input is completely empty (no file path and no instructions), stop and return:
  - `FAILED: provide a .md plan file or describe the changes to implement`
- If the argument is a path ending in `.md`, set `implementation_plan` to the contents of that file.
- Otherwise, set `implementation_plan` to the inline instruction text exactly as provided to the skill.
- Do not run explore-intent in this skill.

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
   node "$HOME/dotfiles/claude-skills/code-implement-loop/scripts/run_dual_patch_review.mjs" \
      --worktree-root "$worktree_root" \
      --implementation-plan "$implementation_plan"
   )"
   ```
2. Do not hand-edit `review_result`.

#### 5d) Handle Reviewer Result

Apply **Shared Review Result Handling** with:

- `review_result="$review_result"`
- `current_round`: the current uncommitted change review round number
- `max_rounds=3`

### 6) Commit After Uncommitted Change Review

After the uncommitted change review loop returns approval, or reaches 3 rounds with `status="revise"` and actionable findings:

- If `in_dd_scope=false`, stop after reporting success and leave the reviewed changes uncommitted in the worktree.
- Otherwise, immediately invoke `commit-smart` to commit and push changes.

Rules:

- Do not ask the user for additional confirmation before running `commit-smart` when `in_dd_scope=true`.
- Do not proceed to the next step until `commit-smart` has completed when `in_dd_scope=true`.
- If `commit-smart` fails in dd scope, report blocked status with the failure reason and attempted remediation.
- Outside dd scope, do not invoke `commit-smart`, do not create or update a PR, and report success once the reviewed patch is complete.

### 7) Run Full Branch Review In DD Scope

- Run a bounded loop with at most **2** rounds.

Each round executes Steps 7a-7c below.

#### 7a) Full Branch Review Preflight

1. Normalize checkout context through the shared helper:
   - `eval "$("$HOME/dotfiles/scripts/git-context.sh")"`
   - The helper must provide: `inside_worktree`, `worktree_root`, `worktree_path`, `branch`, `repo`, `in_dd_scope`.
   - If helper exits non-zero, stop and report blocked status with helper stderr.
2. `cd "$worktree_root"`.
3. Load the PR associated with the current branch:

```bash
if ! pr_meta_json="$(gh pr view --repo "$repo" "$branch" --json number,url,baseRefName,headRefName,headRefOid)"; then
  echo "FAILED: current branch has no associated PR"
  exit 1
fi
```

4. Parse from `pr_meta_json`:
   - `pr_number`
   - `pr_url`
   - `base_ref`
   - `head_ref`
   - `head_sha`

```bash
pr_number="$(jq -r '.number' <<<"$pr_meta_json")"
pr_url="$(jq -r '.url' <<<"$pr_meta_json")"
base_ref="$(jq -r '.baseRefName' <<<"$pr_meta_json")"
head_ref="$(jq -r '.headRefName' <<<"$pr_meta_json")"
head_sha="$(jq -r '.headRefOid' <<<"$pr_meta_json")"
```

If `pr_url` is empty or `null`, stop and return `BLOCKED: no associated PR for full branch review`.

5. Confirm the current checkout matches the inferred PR:
   - `branch` from the helper must equal `head_ref`
   - `git rev-parse HEAD` must equal `head_sha`
   - if any check fails, stop and report the mismatch
6. Do not require the worktree to be clean. Round 1 normally reviews the pushed PR branch with a clean worktree; later rounds must include uncommitted review fixes.

#### 7b) Run Reviewer Script

1. Run the shared structured full branch reviewer:

```bash
full_review_result="$(
  node "$HOME/dotfiles/claude-skills/code-implement-loop/scripts/run_dual_pr_branch_review.mjs" \
    --worktree-root "$worktree_root" \
    --repo "$repo" \
    --branch "$branch"
)"
```

2. Do not hand-edit `full_review_result`.

#### 7c) Handle Reviewer Result

Apply **Shared Review Result Handling** with:

- `review_result="$full_review_result"`
- `current_round`: the current full branch review round number
- `max_rounds=2`

Rules:

- The helper fetches `origin/$base_ref`, validates the current branch equals the PR head branch, validates local `HEAD` equals the remote PR head, computes `git merge-base HEAD origin/$base_ref`, and asks both reviewers to inspect `git diff <review_base>` plus untracked non-ignored files.
- The helper does not require a clean worktree, so later rounds include uncommitted review fixes.
- After assembling branch context and prompt, the helper uses the same `scripts/review-output.schema.json` schema, runner, parsing, and aggregation logic as the uncommitted change review loop. Reviewer output must not be freeform prose.

### 8) Commit Full Branch Review Fixes

After the full branch review loop returns approval, or reaches 2 rounds with `status="revise"` and actionable findings:

- If `git status --porcelain` is empty, skip this step and proceed to Step 9.
- If there are uncommitted changes, immediately invoke `commit-smart` to commit and push the review fixes.

Rules:

- Do not ask the user for additional confirmation before running the second `commit-smart`.
- Do not end the workflow as success until this second `commit-smart` has completed when review fixes exist.
- If the second `commit-smart` fails, report blocked status with the failure reason and attempted remediation.

### 9) Publish Unaddressed Full Branch Review As A PR Comment

After Step 8 completes or is skipped, inspect the last `full_review_result` from Step 7. If its final status is `revise` and findings remain, render those findings and upsert a marked PR comment:

```bash
review_comment_result=""
full_review_status="$(jq -r '.status' <<<"$full_review_result")"
review_marker='<!-- ping-xia-full-branch-review:v1 -->'
review_owner_login="$(gh api user --jq '.login')"
if [[ "$full_review_status" == "revise" ]] && \
   [[ "$(jq '.findings | length' <<<"$full_review_result")" -gt 0 ]]; then
  review_comment_body="$(
    jq -r \
      --arg marker "$review_marker" \
      --arg worktree_root "$worktree_root" \
      '
        [
          $marker,
          "",
          "## Unaddressed Full Branch Review",
          "",
          "The final full-branch review still has findings after the bounded fix loop.",
          "",
          .overall_explanation,
          "",
          ([
            .findings[] |
            "### \(.reviewer) — \(.title)\n\n\(.body)\n\n**Evidence:** \(.evidence)\n\n**Location:** `\(.code_location.absolute_file_path | ltrimstr($worktree_root + "/")):\(.code_location.line_range.start)-\(.code_location.line_range.end)`"
          ] | join("\n\n"))
        ] | join("\n")
      ' <<<"$full_review_result"
  )"
  review_comment_result="$(
    node "$HOME/dotfiles/scripts/upsert_pr_comment.mjs" \
      --pr-url "$pr_url" \
      --marker "$review_marker" \
      --body "$review_comment_body" \
      --owner-login "$review_owner_login"
  )"
elif [[ "$full_review_status" == "approved" ]]; then
  review_comment_result="$(
    node "$HOME/dotfiles/scripts/upsert_pr_comment.mjs" \
      --pr-url "$pr_url" \
      --marker "$review_marker" \
      --owner-login "$review_owner_login" \
      --delete-existing
  )"
fi
```

Rules:

- Treat findings as unaddressed only when the last full branch review round returned `status=="revise"` with findings after the bounded fix loop ended. Do not publish an intermediate round.
- Do not run another reviewer in this step. Publish the existing structured `full_review_result` without hand-editing it.
- When unaddressed findings remain, use `scripts/upsert_pr_comment.mjs` to create or update the comment owned by `<!-- ping-xia-full-branch-review:v1 -->`.
- When the last full branch review returned `status=="approved"`, delete an existing marked comment and do not create a new one.
- Wait for the helper command to finish when it runs.
- Do not block on any result from this step, including helper failures or invalid JSON.
- Do not apply **Shared Review Result Handling** to this step.
- Do not use this helper output for workflow control.

### 10) Request Codex review

Post `@codex review` as a top-level PR comment:

```bash
gh pr comment --repo "$repo" "$pr_url" --body "@codex review"
```

If the comment fails to post, carry the failure into the final status but continue to Step 11.

### 11) Return final status

Success format:

- In dd scope: `SUCCESS: Implementation complete, uncommitted change review completed, full branch review completed | PR: {url}`
- Outside dd scope: `SUCCESS: Implementation complete, uncommitted change review completed | PR: none`
- If the uncommitted change review continued after 3 rounds without approval, append: `| Uncommitted change findings: {summary} | Attempts: {summary}`
- If the full branch review continued after 2 rounds without approval, append: `| Full branch findings: {summary} | Attempts: {summary}`
- If the Codex review comment failed to post in Step 10, append: `| Warning: failed to request Codex review: {exact error summary}`

Blocked format:

`BLOCKED: commit-smart failed | PR: {url} | Error: {summary} | Attempts: {summary}`

or

`BLOCKED: Full branch review failed | PR: {url} | Error: {summary}`

or

`BLOCKED: second commit-smart failed | PR: {url} | Error: {summary} | Attempts: {summary}`
