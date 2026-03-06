---
name: code-implement-loop
description: "Trigger this skill when implementation should start: if Codex/Claude proposes a plan and the user says to implement it, or if the user explicitly invokes this skill. Accepted implementation input sources are: a Codex/Claude-proposed plan, a user-provided `.md` plan/design file, or user-provided inline implementation instructions."
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

### 5) Run Ralph Wiggum PR-aware review/fix loop

Run a bounded loop with at most 5 rounds.
Each round must use a **new reviewer sub-agent** (fresh context).
DO NOT COMMIT inside this loop.

Review scope policy:

- Use PR-aware review scope by default (full prospective PR delta), not local incremental `git diff` only.
- This skill should follow PR-grade base/head behavior for higher review quality.
- Re-review the full prospective PR delta on every round (not unresolved-only incremental review).
  - Meaning: if round 1 reports findings A/B/C and you fix A, round 2 still reviews the whole `merge_base..current` delta instead of only A/B/C hunks. This catches fix-induced regressions.

Defaults:

- `MAX_ROUNDS = 5`
- completion token: `<promise>IMPLEMENTATION_COMPLETE</promise>`
- review quality bar: high bug-risk focus (`correctness`, `regression`, `security`, `compat`, `performance`, `tests`); do not block on pure style nits.

Pre-loop context setup:

1. Normalize checkout context through shared helper (works in repo root, subfolder, or linked worktree):
   - `eval "$("$HOME/dotfiles/scripts/git-context.sh")"`
   - The helper must provide: `inside_worktree`, `worktree_root`, `worktree_path`, `branch`, `repo`, `in_dd_scope`.
   - If helper exits non-zero, stop and report blocked status with helper stderr.
   - `cd "$worktree_root"` so all commands run from a stable root.
2. Resolve review base branch (PR base fallback to default branch):
   - `base_branch="$(gh pr list --repo "$repo" --head "$branch" --state open --json baseRefName --jq '.[0].baseRefName' 2>/dev/null || true)"`
   - If empty: `base_branch="$(gh repo view --repo "$repo" --json defaultBranchRef -q '.defaultBranchRef.name' 2>/dev/null || true)"`
   - If still empty: fallback `base_branch=main`
3. Ensure base ref is available locally:
   - `git fetch origin "$base_branch" --quiet` (best effort; continue if already present)
4. Compute merge-base:
   - `merge_base="$(git merge-base HEAD "origin/$base_branch" 2>/dev/null || true)"`
   - If empty, stop and report blocked status with explicit base-resolution failure.
5. Detect open PR for current branch (best effort):
   - `pr_url="$(gh pr list --repo "$repo" --head "$branch" --state open --json url --jq '.[0].url' 2>/dev/null || true)"`
   - Default value: `unresolved_pr_feedback='[]'`
   - If `pr_url` is non-empty, ingest unresolved review threads/comments:
     - `pr_number="$(gh pr view "$pr_url" --repo "$repo" --json number --jq '.number' 2>/dev/null || true)"`
     - `owner="${repo%%/*}"; repo_name="${repo##*/}"`
     - If `pr_number` is non-empty:
       - `unresolved_pr_feedback="$(gh api graphql -f query='query($owner:String!, $name:String!, $number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved isOutdated comments(first:30){nodes{author{login} path line body}}}}}}}' -F owner="$owner" -F name="$repo_name" -F number="$pr_number" 2>/dev/null | jq -c '[.data.repository.pullRequest.reviewThreads.nodes[]? | select((.isResolved|not) and (.isOutdated|not)) | .comments.nodes[]? | {author:.author.login,path,line,body}]' || echo '[]')"`
   - If unavailable or `gh` query fails, continue in degraded mode (`unresolved_pr_feedback='[]'`) and note it in loop logs.

Per-round review context pack (rebuild every round):

1. Full prospective PR diff from merge base to current working tree:
   - `review_diff=$(git diff --binary "$merge_base")`
2. Changed-file status list:
   - `changed_files=$(git diff --name-status "$merge_base")`
3. Changed-file full-content context:
   - Include current contents of changed files from working tree (truncate deterministically to first 400 lines per file).
   - For deleted files, include patch hunks and prior path metadata only.
4. Verification evidence:
   - Include latest targeted test/build command outputs and pass/fail summaries run during this loop.
5. Unresolved feedback evidence:
   - `unresolved_findings_ledger` from prior rounds.
   - ledger key format: `title + code_location.absolute_file_path + code_location.line_range.start`.
   - unresolved PR comments/threads (when retrievable).

Fixed reviewer prompt:

- Canonical reviewer prompt file:
  - `references/reviewer-prompt-codex-cli.md`
- Inject round context into that prompt using placeholders:
  - `{review_diff}`, `{changed_files}`, `{changed_file_context}`,
    `{task_goal}`, `{verification_summary}`,
    `{unresolved_findings_ledger}`, `{unresolved_pr_feedback}`.
- The reviewer must return strict JSON only (no prose, no markdown fences), matching the schema in the prompt file.

Per round:

1. Rebuild the full review context pack listed above.
2. Launch a new reviewer sub-agent with fresh context:
   - Review inputs must include the full context pack.
   - The sub-agent model must use the same model as the main agent.
3. Validate reviewer output schema:
   - Parse output as strict JSON (no markdown fences or extra prose).
   - Validate exactly against the `OUTPUT FORMAT` schema in `references/reviewer-prompt-codex-cli.md` (single source of truth).
   - If output is malformed or schema-invalid, rerun reviewer once with a schema reminder.
   - If still invalid, stop and return blocked status with the invalid payload summary and validator errors.
4. Evaluate approval gate:
   - If `findings` is empty and `overall_correctness` is `patch is correct`, emit `<promise>IMPLEMENTATION_COMPLETE</promise>` and stop.
   - If `findings` is empty and `overall_correctness` is `patch is incorrect`, rerun reviewer once for consistency; if still inconsistent, stop and return blocked status with both payloads summarized.
5. If `findings` is non-empty:
   - fix unresolved items only, prioritized by `priority` ascending (`0` -> `3`; unknown priority after known priorities),
   - rerun targeted verification,
   - update `unresolved_findings_ledger` with still-open findings only (drop resolved findings),
   - keep changes uncommitted for the next round.
6. If not approved after `MAX_ROUNDS`, emit blocked status with unresolved list and attempted fixes.

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
