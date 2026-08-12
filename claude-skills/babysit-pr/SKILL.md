---
name: babysit-pr
description: "Babysit the GitHub PR associated with the current branch: check and resolve merge conflicts, wait for DDCI orchestration to finish, loop on `dd-gitlab/*` CI checks until they pass, then automatically plan and implement unresolved actionable review comments after at most two plan-review rounds; rerun CI after comment-driven changes, classify concrete CI failures, merge the latest base when failures look external, use `code-implement-loop` without its full-branch review for PR-caused failures, and update the PR body at the end."
---

# Babysit PR

## Hard Rules

- First, review the `# Global Rules` from your memory file and apply them before the skill-specific rules below.
- Infer the PR from the current branch with `gh`, then validate that local state matches the inferred PR.
- Do not broaden scope beyond:
  - merge-conflict remediation against the latest PR base branch
  - implementing unresolved actionable PR review comments
  - fixing failing `dd-gitlab/*` CI jobs
  - updating the PR body at the end
- Treat `dd-gitlab/default-pipeline` as a rollup check, not a concrete job trace source.
- Never reply to or resolve a review thread. Ignore comments classified as `reply_only` after plan review.
- Always invoke `code-implement-loop` with `--skip-full-branch-review`. This skill owns the complete PR-level loop and must not start a separate full-branch review from an implementation subflow.

## Workflow

### Phase 0: Preflight

1. Resolve repo scope and enforce the strict coding preflight:
   - `eval "$("$HOME/dotfiles/scripts/coding-preflight.mjs")"`
   - The helper must provide: `inside_worktree`, `worktree_root`, `worktree_path`, `branch`, `repo`, `in_dd_scope`, `origin_branch_ref`, `origin_branch_exists`, `local_ahead_count`, `origin_ahead_count`.
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

If `pr_url` is empty or `null`, stop and return `FAILED: current branch has no associated PR`.

5. Confirm the current checkout matches the inferred PR:
   - `branch` from the helper must equal `head_ref`
   - `git rev-parse HEAD` must equal `head_sha`
   - if any check fails, stop and report the mismatch

### Phase 1: Check mergeability

1. Query GitHub for the PR mergeability state:

```bash
merge_state_json="$(gh pr view --repo "$repo" "$pr_url" --json mergeable,mergeStateStatus)"
mergeable="$(jq -r '.mergeable' <<<"$merge_state_json")"
merge_state_status="$(jq -r '.mergeStateStatus' <<<"$merge_state_json")"
```

2. If `mergeable=="UNKNOWN"`, wait briefly and repoll a small number of times so GitHub can finish computing mergeability.
3. Interpret the result from GitHub:
   - `mergeable=="MERGEABLE"`: no conflict-driven merge is needed at this stage
   - `mergeable=="CONFLICTING"`: the PR branch conflicts with the latest base branch
   - any other value, or a persistent `UNKNOWN`: stop and report `mergeable` and `mergeStateStatus` as blocked

### Phase 2: Resolve merge conflicts when needed

Run this phase only when Phase 1 reports `mergeable=="CONFLICTING"`.

1. Refresh and merge the latest base branch into the PR branch:

```bash
git fetch origin "$base_ref"
git merge --no-ff "origin/$base_ref"
```

2. Resolve conflicts with the smallest change that restores the intended PR behavior.
3. Run the minimum targeted verification needed for the conflict resolution.
4. Invoke `commit-smart` immediately to create the merge commit and push it.
5. After `commit-smart` completes, continue into the CI loop below.

### Phase 3: Run `dd-gitlab/*` CI until green

Use this phase for both the initial CI run and the CI rerun after comment-driven changes. Run the following loop until every `dd-gitlab/*` check has passed.

Each iteration includes these actions:

1. Refresh the checks:

```bash
checks_json="$(gh pr checks --repo "$repo" "$pr_url" --json name,workflow,state,bucket,link)"
ddci_status_checks_json="$(
  jq '
    map(select(.name == "DDCI Status"))
  ' <<<"$checks_json"
)"
dd_gitlab_checks_json="$(
  jq '
    map(select(.name | startswith("dd-gitlab/")))
  ' <<<"$checks_json"
)"
```

2. Before evaluating `dd-gitlab/*`, require DDCI orchestration to reach a terminal state:
   - if there are zero `DDCI Status` checks, treat orchestration as not started yet; sleep for a fixed interval such as `60` seconds, then start the next loop iteration
   - if any `DDCI Status` check has `bucket=="pending"`, orchestration may still publish additional `dd-gitlab/*` checks; sleep for a fixed interval such as `60` seconds, then start the next loop iteration
   - only evaluate `dd-gitlab/*` after at least one `DDCI Status` check exists and none are pending
   - do not declare `dd-gitlab/*` green merely because all currently visible checks passed while `DDCI Status` was absent or pending
3. Partition the `dd-gitlab/*` checks:
   - `pending`: `bucket=="pending"`
   - `failed`: `bucket=="fail"` or `bucket=="cancel"`
   - `passed`: `bucket=="pass"`
4. If there are zero `dd-gitlab/*` checks, treat that as "jobs not started yet" rather than success. Sleep for a fixed interval such as `60` seconds, then start the next loop iteration.
5. If any `dd-gitlab/*` checks are still pending, do not handle failures yet. Sleep for a fixed interval such as `60` seconds, then start the next loop iteration.
6. Once DDCI is terminal and there are one or more `dd-gitlab/*` checks with zero pending `dd-gitlab/*` checks:
   - if all `dd-gitlab/*` checks passed, skip the remaining actions in this iteration and exit the loop
   - otherwise continue with the failure-handling actions below
7. Split the failed `dd-gitlab/*` checks into:
   - `fetchable_failed_jobs`: failed checks whose `link` contains `taskId=gitlab` and `taskExecutionId=`
   - `rollup_only_failures`: failed checks such as `dd-gitlab/default-pipeline` whose link does not include a concrete `taskExecutionId=`
8. If there are no `fetchable_failed_jobs`, stop and report blocked status with the failing rollup checks. The skill cannot fetch logs for a rollup-only failure.
9. For each job in `fetchable_failed_jobs`:
   - fetch the failure log with:

   ```bash
   node "$HOME/dotfiles/scripts/fetch-mosaic-ci-log.mjs" "<mosaic-link>"
   ```

   - treat the JSON returned by `fetch-mosaic-ci-log.mjs` as the source of truth for:
     - `web_url`: the GitLab job URL
     - `trace_file`: the local path to the fetched trace file
   - read `trace_file` and extract:
     - the failing Bazel target or job stage
     - the failing test name or command when present
     - the concrete error text or exception
     - a concise failure summary
     - whether the failure is likely caused by this PR
   - classify each job as either:
     - `likely caused by this PR`
     - `likely not caused by this PR`
   - treat failures like the following as `likely not caused by this PR` unless stronger evidence points to the patch:
     - checkout/bootstrap failures before repo code executes
     - `gitretriever fetch failed`
     - source fetch or checkout cleanup failures
     - runner or CI environment bootstrap failures
     - truncated logs with no concrete repo target, test, or command failure visible

10. If **any** job in `fetchable_failed_jobs` is classified as `likely not caused by this PR`, do not invoke `code-implement-loop` yet. Remediate against the freshest base branch first:
   - run:

   ```bash
   git fetch origin "$base_ref"
   ```

   - if the fetch fails, stop and report blocked status
   - if the current branch already contains the freshly fetched `origin/$base_ref`, stop and report blocked status rather than retrying CI unchanged
   - otherwise merge the freshly fetched base:

   ```bash
   git merge --no-ff "origin/$base_ref"
   ```

   - if the merge conflicts, resolve them with the smallest change that restores intended PR behavior
   - run the minimum targeted verification needed for the merge or conflict resolution
   - invoke `commit-smart` immediately to create or push the merge result
   - after `commit-smart` completes, sleep for a fixed interval such as `60` seconds, then start the next loop iteration.

11. Hand off `fetchable_failed_jobs` that are still classified as `likely caused by this PR` to `code-implement-loop`. The handoff must include, for each such job:

- the PR URL
- the GitLab job URL from `web_url`
- the local trace file path from `trace_file`
- the failure summary extracted from the trace

12. Invoke `code-implement-loop --skip-full-branch-review` with that raw failure context as the entire implementation scope.
13. If `code-implement-loop` returns blocked status, propagate it and stop.
14. If `code-implement-loop` succeeds, start the next iteration of this CI loop and repoll the `dd-gitlab/*` checks.

Example handoff to `code-implement-loop`:

```text
Fix the failing dd-gitlab CI jobs for PR https://github.com/DataDog/dd-source/pull/406053 only.

- dd-gitlab/test-all:unit
  PR: https://github.com/DataDog/dd-source/pull/406053
  GitLab job: https://gitlab.ddbuild.io/DataDog/dd-source/-/jobs/1620901756
  Trace file: /tmp/mosaic-ci-1620901756/job-1620901756.log
  Summary: //domains/assistant/apps/apis/assistant_api:py_default_test failed because test_background_worker.py::test_run_command_agent_populates_background_worker_payload raised TypeError: object MagicMock can't be used in 'await' expression

```

### Phase 4: Process unresolved review comments once

Run this phase once, after the initial Phase 3 CI run is green.

#### 4a) Create the comment address plan

1. Invoke the `plan-pr-comments` skill exactly once to create the initial plan. Use `$HOME/dotfiles/claude-skills/plan-pr-comments/SKILL.md` with the validated `pr_url` and no `provided_comment_text`.
2. After the planner returns, this skill owns `comments_to_address` and `comment_address_plan` for the rest of Phase 4. Do not invoke `plan-pr-comments` again or reload the comments. Handle every automated review and revision in subsection 4b within this skill.
3. If the planner returns `NOOP: no comments to address`, record zero processed comments and continue to Phase 5.

#### 4b) Review and revise the plan at most twice

Use `comment_address_plan` from subsection 4a. Run at most two review rounds.

For each round, invoke:

```bash
plan_review_result="$(
  node "$HOME/dotfiles/claude-skills/babysit-pr/scripts/run_auto_comment_plan_review.mjs" \
    --worktree-root "$worktree_root" \
    --pr-url "$pr_url" \
    <<<"$comment_address_plan"
)"
```

Parse `plan_review_result` as strict JSON with:

- `status`: `approved`, `revise`, or `blocked`
- `comments`: concrete plan-review feedback
- `overall_explanation`: review summary
- `reviewers`: reviewer status map

Apply this control flow:

1. If the output is invalid or `status=="blocked"`, stop and return blocked status. Do not implement an unreviewed plan.
2. If `status=="approved"`, stop the review loop and use the current `comment_address_plan`.
3. If `status=="revise"`, revise only the plan to address every review comment while preserving a section for every original `comments_to_address` item.
4. After round 1, review the revised plan once more.
5. After round 2, apply its review comments to the plan once, then stop. Do not request a third review.

The resulting plan is `reviewed_comment_address_plan`.

#### 4c) Ignore reply-only items and implement actionable items

1. Derive `implementation_plan` by copying only the complete sections whose decision is `implementation_needed` from `reviewed_comment_address_plan`, in their original order.
2. Preserve each copied section verbatim, including its heading, raw comment, decision, reasoning, and plan.
3. Ignore every `reply_only` section:
   - do not post its proposed reply
   - do not invoke `reply_to_review_thread.sh`
   - do not resolve its review thread
   - do not include it in `implementation_plan`
4. Verify that `implementation_plan` contains no `reply_only` section. If the check fails, stop and return `BLOCKED: failed to build actionable comment implementation plan | PR: <url>`.
5. If `implementation_plan` is empty, record the reply-only count and continue to Phase 5 without invoking `code-implement-loop`.
6. If `implementation_plan` is non-empty, invoke `code-implement-loop --skip-full-branch-review` once using the filtered plan as its direct inline implementation input and preserve its complete output as `comment_implementation_result`.
7. Do not block or stop based on `comment_implementation_result`, including blocked, failed, or invalid output. Record its status and exact error summary for Phase 6.
8. Rerun Phase 3 so CI validates the current PR head. When CI is green, continue to Phase 5. Do not rerun Phase 4.

### Phase 5: Update PR body

If this `babysit-pr` run did not make any code changes, skip this phase without invoking `pr-body` and continue to Phase 6.

After all `dd-gitlab/*` checks pass, invoke the `pr-body` skill at `$HOME/dotfiles/claude-skills/pr-body/SKILL.md` with `pr_url`.

Treat `UPDATED` and `SKIPPED` results from `pr-body` as successful completion of this phase. Treat `BLOCKED` as a blocked status and stop.

### Phase 6: Return final status

Use one of:

- `SUCCESS: review comments processed (<actionable-count> actionable, <reply-only-count> reply-only ignored), dd-gitlab checks green, and PR body updated | PR: <url>`
- `SUCCESS: review comments processed (<actionable-count> actionable, <reply-only-count> reply-only ignored), dd-gitlab checks green, and PR body left unchanged because existing body is unmarked | PR: <url>`
- `SUCCESS: review comments processed (<actionable-count> actionable, <reply-only-count> reply-only ignored), dd-gitlab checks green, and PR body update skipped because no code changes were made | PR: <url>`
- If `code-implement-loop` was invoked for review comments, append `| Comment implementation result: <status and exact error summary, if any>` to the selected success status. Never convert that result into blocked status.
- `BLOCKED: merge conflict check failed | PR: <url> | Error: <summary>`
- `BLOCKED: automatic comment plan review failed | PR: <url> | Error: <summary>`
- `BLOCKED: failed to build actionable comment implementation plan | PR: <url>`
- `BLOCKED: rollup-only dd-gitlab failure without fetchable jobs | PR: <url>`
- `BLOCKED: external-looking dd-gitlab failure but branch already includes latest base | PR: <url>`
- `BLOCKED: CI code-implement-loop failed | PR: <url> | Error: <summary>`
- `BLOCKED: <reason> | PR: <url>`
