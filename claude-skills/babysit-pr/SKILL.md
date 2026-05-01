---
name: babysit-pr
description: "Babysit a GitHub PR from a PR URL: check whether merging the latest base branch would conflict, resolve and commit merge conflicts with `commit-smart` when needed, then loop on `dd-gitlab/*` CI checks until they pass; when concrete dd-gitlab jobs fail, classify the fetched Mosaic traces, merge the latest base when failures look external, use `code-implement-loop` only for failures that are likely caused by the PR, update the PR body at the end, and run PR reviews."
---

# Babysit PR

## Hard Rules

- First, review the `# Global Rules` from your memory file and apply them before the skill-specific rules below.
- Assume the current checkout is already on the correct PR branch and commit for the input PR. Validate that assumption and stop on mismatch.
- Do not broaden scope beyond:
  - merge-conflict remediation against the latest PR base branch
  - fixing failing `dd-gitlab/*` CI jobs
  - updating the PR body at the end
  - parallel Codex and Claude PR reviews after checks are green
- Treat `dd-gitlab/default-pipeline` as a rollup check, not a concrete job trace source.

## Input Contract

- Input: one PR URL such as `https://github.com/DataDog/dd-source/pull/406053`
- If the URL is missing or malformed, stop and return:
  - `FAILED: provide a PR URL`

## Workflow

### 0) Preflight

1. Resolve repo scope and enforce the strict coding preflight:
   - `eval "$("$HOME/dotfiles/scripts/coding-preflight.mjs")"`
   - The helper must provide: `inside_worktree`, `worktree_root`, `worktree_path`, `branch`, `repo`, `in_dd_scope`, `origin_branch_ref`, `origin_branch_exists`, `local_ahead_count`, `origin_ahead_count`.
   - If helper exits non-zero, stop and report blocked status with helper stderr.
2. `cd "$worktree_root"`.
3. Load PR context with:

```bash
pr_ctx_json="$(node "$HOME/dotfiles/scripts/fetch-pr-context.mjs" "<pr-url>")"
```

4. Parse from `pr_ctx_json`:
   - `repo`
   - `pr_number`
   - `pr_url`
5. Load the current PR refs:

```bash
pr_meta_json="$(gh pr view --repo "$repo" "$pr_number" --json baseRefName,headRefName,headRefOid,url)"
base_ref="$(jq -r '.baseRefName' <<<"$pr_meta_json")"
head_ref="$(jq -r '.headRefName' <<<"$pr_meta_json")"
head_sha="$(jq -r '.headRefOid' <<<"$pr_meta_json")"
```

6. Confirm the current checkout matches the PR you were given:
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
   - `mergeable=="MERGEABLE"`: no conflict-driven merge is needed at this stage
   - `mergeable=="CONFLICTING"`: the PR branch conflicts with the latest base branch
   - any other value, or a persistent `UNKNOWN`: stop and report `mergeable` and `mergeStateStatus` as blocked

### 2) If conflicts exist, merge latest base, resolve them, and commit

Only run this step when Step 1 found real merge conflicts.

1. Refresh and merge the latest base branch into the PR branch:

```bash
git fetch origin "$base_ref"
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

9. If **any** job in `fetchable_failed_jobs` is classified as `likely not caused by this PR`, do not invoke `code-implement-loop` yet. Remediate against the freshest base branch first:
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

10. Hand off `fetchable_failed_jobs` that are still classified as `likely caused by this PR` to `code-implement-loop`. The handoff must include, for each such job:

- the PR URL
- the GitLab job URL from `web_url`
- the local trace file path from `trace_file`
- the failure summary extracted from the trace

12. Invoke `code-implement-loop` with that raw failure context as the entire implementation scope.
13. If `code-implement-loop` returns blocked status, propagate it and stop.
14. If `code-implement-loop` succeeds, continue the loop and return to Step 3.1 to repoll the `dd-gitlab/*` checks.

Example handoff to `code-implement-loop`:

```text
Fix the failing dd-gitlab CI jobs for PR https://github.com/DataDog/dd-source/pull/406053 only.

- dd-gitlab/test-all:unit
  PR: https://github.com/DataDog/dd-source/pull/406053
  GitLab job: https://gitlab.ddbuild.io/DataDog/dd-source/-/jobs/1620901756
  Trace file: /tmp/mosaic-ci-1620901756/job-1620901756.log
  Summary: //domains/assistant/apps/apis/assistant_api:py_default_test failed because test_background_worker.py::test_run_command_agent_populates_background_worker_payload raised TypeError: object MagicMock can't be used in 'await' expression

```

### 4) Update PR body

After all `dd-gitlab/*` checks pass, review the entire PR change, not just commits or fixes made during this skill run:

```bash
gh pr view --repo "$repo" "$pr_url" --json title,body,commits,files
gh pr diff --repo "$repo" "$pr_url"
```

Only update the PR body when the existing PR body starts with the hidden marker:

```html
<!-- pr-body:v1 -->
```

If the existing PR body does not start with this marker, treat it as manually edited and skip the PR body update.

Update the marked body by splicing new generated content into the existing body:

1. Keep the original body as the base text. Do not regenerate the whole body from scratch.
2. Locate level-2 section headings with lines that start with `## `.
3. Generate new content only for the managed `## Problem` and `## Approach` sections, using the PR title, existing marked body, commit list, changed files, and full PR diff.
4. Upsert the `## Problem` section:
   - If a line exactly matching `## Problem` exists, replace that full section. The section starts at `## Problem` and ends immediately before the next `## ` heading, or at end of body.
   - If it does not exist, create a new `## Problem` section after the marker and any immediately following blank lines.
5. Upsert the `## Approach` section:
   - If a line exactly matching `## Approach` exists, replace that full section. The section starts at `## Approach` and ends immediately before the next `## ` heading, or at end of body.
   - If it does not exist, create a new `## Approach` section immediately after the `## Problem` section.
6. The `## Problem` section must be:
   ```markdown
   ## Problem

   <why this change is needed>
   ```
7. The `## Approach` section must be:
   ```markdown
   ## Approach

   <key implementation choices>
   ```
8. Leave every byte outside those two managed sections unchanged. Do not edit, reorder, remove, or regenerate any other section or content.
9. Then update the PR body with:
  ```bash
  gh pr edit --repo "$repo" "$pr_url" --body-file "<body-file>"
  ```

**Focus on the high-level problem and approach**

- Skip mechanical details such as added unit tests, renamed variables, changed function arguments, or other implementation minutiae unless they are essential to understanding the design.
- The goal is to state the problem clearly and lay out the high-level approach so reviewers can review the PR efficiently.

### 5) Run dual PR review and update PR (best effort)

Run the bundled helper:

```bash
review_result="$(
  node "$HOME/dotfiles/claude-skills/babysit-pr/scripts/run_dual_pr_review.mjs" \
    --worktree-root "$worktree_root" \
    --repo "$repo" \
    --pr-number "$pr_number" \
    --pr-url "$pr_url" \
    --base-ref "$base_ref"
)"
```

Parse `review_result` as JSON:

- `status`: `approved`, `revise`, or `error`
- `reviewers`: reviewer status map
- `review_file`: local review artifact path, when available
- `review_comment`: PR comment upsert result, when available
- `error`: summary of review or comment publication errors, when present

Do not block on any Step 5 result, including `status=="error"` or invalid JSON. Carry the parsed result or raw helper output into the final status only.

### 6) Return final status

Use one of:

- `SUCCESS: dd-gitlab checks green, PR body updated, and review summary comment upserted | PR: <url>`
- `SUCCESS: dd-gitlab checks green, PR body left unchanged because existing body is unmarked, and review summary comment upserted | PR: <url>`
- `SUCCESS: dd-gitlab checks green and PR body step completed, but review summary comment was not upserted | PR: <url> | Warning: <exact review or upsert error summary>`
- `BLOCKED: merge conflict check failed | PR: <url> | Error: <summary>`
- `BLOCKED: rollup-only dd-gitlab failure without fetchable jobs | PR: <url>`
- `BLOCKED: external-looking dd-gitlab failure but branch already includes latest base | PR: <url>`
- `BLOCKED: code-implement-loop failed | PR: <url> | Error: <summary>`
- `BLOCKED: <reason> | PR: <url>`
