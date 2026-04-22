---
name: babysit-pr
description: "Babysit a GitHub PR from a PR URL: check whether merging the latest base branch would conflict, resolve and commit merge conflicts with `commit-smart` when needed, then loop on `dd-gitlab/*` CI checks until they pass; when concrete dd-gitlab jobs fail, fetch their Mosaic traces with `scripts/fetch-mosaic-ci-log.mjs`, use `code-implement-loop` to fix the failures, and finish by updating the PR with `pr-review-guidance`."
---

# Babysit PR

## Hard Rules

- Use `gh` for all GitHub access.
- Never change the current branch name manually.
- Assume the current checkout is already on the correct PR branch and commit for the input PR. Validate that assumption and stop on mismatch.
- Do not broaden scope beyond:
  - merge-conflict remediation against the latest PR base branch
  - fixing failing `dd-gitlab/*` CI jobs
  - updating PR review guidance at the end
- Treat `dd-gitlab/default-pipeline` as a rollup check, not a concrete job trace source.


## Input Contract

- Input: one PR URL such as `https://github.com/DataDog/dd-source/pull/406053`
- If the URL is missing or malformed, stop and return:
  - `FAILED: provide a PR URL`

## Workflow

### 0) Preflight

1. Resolve the current branch: `branch="$(git rev-parse --abbrev-ref HEAD)"`.
2. Resolve repo scope early: `eval "$("$HOME/dotfiles/scripts/git-context.sh")"`.
   - The helper must provide: `inside_worktree`, `worktree_root`, `worktree_path`, `branch`, `repo`, `in_dd_scope`.
   - If helper exits non-zero, stop and report blocked status with helper stderr.
3. `cd "$worktree_root"`.
4. If `branch` is `HEAD` (detached HEAD) and `in_dd_scope=true`, stop and ask the user — this skill requires a named branch for the commit flow in dd scope.
5. Check whether an upstream exists: `git rev-parse --verify --quiet "refs/remotes/origin/$branch"`.
   - If it does not exist (local-only branch), skip the divergence check and proceed.
6. If the upstream exists and local `HEAD` has diverged from `origin/$branch` (each side has commits the other lacks), stop and ask the user.
7. Load PR context with:

```bash
pr_ctx_json="$("$HOME/dotfiles/scripts/fetch-pr-context.sh" "<pr-url>")"
```

8. Parse from `pr_ctx_json`:
   - `repo`
   - `pr_number`
   - `pr_url`
9. Load the current PR refs:

```bash
pr_meta_json="$(gh pr view --repo "$repo" "$pr_number" --json baseRefName,headRefName,headRefOid,url)"
base_ref="$(jq -r '.baseRefName' <<<"$pr_meta_json")"
head_ref="$(jq -r '.headRefName' <<<"$pr_meta_json")"
head_sha="$(jq -r '.headRefOid' <<<"$pr_meta_json")"
```

10. Confirm the current checkout matches the PR you were given:
   - `repo` from the helper must equal the PR repo
   - `branch` from the helper must equal `head_ref`
   - `git rev-parse HEAD` must equal `head_sha`
   - if any check fails, stop and report the mismatch

### 1) Check whether merging the latest base branch would conflict

1. Query GitHub for the PR mergeability state:

```bash
merge_state_json="$(gh pr view --repo "$repo" "$pr_url" --json mergeable,mergeStateStatus)"
mergeable="$(jq -r '.mergeable' <<<"$merge_state_json")"
merge_state_status="$(jq -r '.mergeStateStatus' <<<"$merge_state_json")"
```

2. If `mergeable=="UNKNOWN"`, wait briefly and repoll a small number of times so GitHub can finish computing mergeability.
3. Interpret the result from GitHub:
   - `mergeable=="MERGEABLE"`: no merge conflicts; do not merge the base branch
   - `mergeable=="CONFLICTING"`: the PR branch conflicts with the latest base branch
   - any other value, or a persistent `UNKNOWN`: stop and report `mergeable` and `mergeStateStatus` as blocked

### 2) If conflicts exist, merge latest base, resolve them, and commit

Only run this step when Step 1 found real merge conflicts.

1. Merge the latest base branch into the PR branch:

```bash
git merge --no-ff "origin/$base_ref"
```

2. Resolve conflicts with the smallest change that restores the intended PR behavior.
3. Run the minimum targeted verification needed for the conflict resolution.
4. Invoke `commit-smart` immediately to create the merge commit and push it.
5. After `commit-smart` completes, continue into the CI loop below.

### 3) Loop on `dd-gitlab/*` checks until they all pass

Run the following loop until every `dd-gitlab/*` check has passed.

Each iteration includes these steps:

1. Refresh the checks:

```bash
checks_json="$(gh pr checks --repo "$repo" "$pr_url" --json name,workflow,state,bucket,link)"
dd_gitlab_checks_json="$(
  jq '
    map(select(.name | startswith("dd-gitlab/")))
  ' <<<"$checks_json"
)"
```

2. Partition the `dd-gitlab/*` checks:
   - `pending`: `bucket=="pending"`
   - `failed`: `bucket=="fail"` or `bucket=="cancel"`
   - `passed`: `bucket=="pass"`
3. If there are zero `dd-gitlab/*` checks, treat that as "jobs not started yet" rather than success. Sleep for a fixed interval such as `60` seconds, then start the next loop iteration.
4. If any `dd-gitlab/*` checks are still pending, do not handle failures yet. Sleep for a fixed interval such as `60` seconds, then start the next loop iteration.
5. Once there are one or more `dd-gitlab/*` checks and zero pending `dd-gitlab/*` checks:
   - if all `dd-gitlab/*` checks passed, skip the remaining steps in this iteration and exit the loop
   - otherwise continue with the failure-handling steps below
6. Split the failed `dd-gitlab/*` checks into:
   - `fetchable_failed_jobs`: failed checks whose `link` contains `taskId=gitlab` and `taskExecutionId=`
   - `rollup_only_failures`: failed checks such as `dd-gitlab/default-pipeline` whose link does not include a concrete `taskExecutionId=`
7. If there are no `fetchable_failed_jobs`, stop and report blocked status with the failing rollup checks. The skill cannot fetch logs for a rollup-only failure.
8. For each job in `fetchable_failed_jobs`:
   - fetch the failure log with:
   ```bash
   node "$HOME/dotfiles/scripts/fetch-mosaic-ci-log.mjs" "<mosaic-link>"
   ```
   - treat the JSON returned by `fetch-mosaic-ci-log.mjs` as the source of truth for:
     - `web_url`: the GitLab job URL
     - `trace_file`: the local path to the fetched trace file
   - read `trace_file` and extract:
     - the failing Bazel target or job step
     - the failing test name or command when present
     - the concrete error text or exception
     - whether the failure is likely caused by this PR
9. After understanding all `fetchable_failed_jobs`, hand off to `code-implement-loop`. The handoff must include, for each failed fetchable job:
   - the PR URL
   - the GitLab job URL from `web_url`
   - the local trace file path from `trace_file`
   - the failure summary extracted from the trace
10. Invoke `code-implement-loop` with that raw failure context as the entire implementation scope.
11. If `code-implement-loop` returns blocked status, propagate it and stop.
12. If `code-implement-loop` succeeds, continue the loop and return to Step 3.1 to repoll the `dd-gitlab/*` checks.

Example handoff to `code-implement-loop`:

```text
Fix the failing dd-gitlab CI jobs for PR https://github.com/DataDog/dd-source/pull/406053 only.

- dd-gitlab/test-all:unit
  PR: https://github.com/DataDog/dd-source/pull/406053
  GitLab job: https://gitlab.ddbuild.io/DataDog/dd-source/-/jobs/1620901756
  Trace file: /tmp/mosaic-ci-1620901756/job-1620901756.log
  Summary: //domains/assistant/apps/apis/assistant_api:py_default_test failed because test_background_worker.py::test_run_command_agent_populates_background_worker_payload raised TypeError: object MagicMock can't be used in 'await' expression

- dd-gitlab/static-build-success
  PR: https://github.com/DataDog/dd-source/pull/406053
  GitLab job: https://gitlab.ddbuild.io/DataDog/dd-source/-/jobs/1620892229
  Trace file: /tmp/mosaic-ci-1620892229/job-1620892229.log
  Summary: This job only reported that an earlier stage failed; treat it as downstream fallout unless new evidence shows otherwise.
```

### 4) Update the PR review guidance

After all `dd-gitlab/*` checks pass, invoke `pr-review-guidance` with the same PR URL.

### 5) Return final status

Use one of:

- `SUCCESS: dd-gitlab checks green and PR review guidance updated | PR: <url>`
- `BLOCKED: merge conflict check failed | PR: <url> | Error: <summary>`
- `BLOCKED: rollup-only dd-gitlab failure without fetchable jobs | PR: <url>`
- `BLOCKED: code-implement-loop failed | PR: <url> | Error: <summary>`
- `BLOCKED: <reason> | PR: <url>`
