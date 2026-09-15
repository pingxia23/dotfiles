---
name: full-branch-review
description: "Run one preflighted, structured review of the current GitHub PR's full local branch diff, including committed, staged, unstaged, and untracked changes; use committed implementation-plan history when available; by default publish each finding as an inline PR review comment at its code location, or suppress publication with `--skip-pr-comment`. Use when asked to review a full PR branch, publish a branch review to a PR, or provide a machine-readable full-branch review result to a caller such as `code-implement-loop`."
---

# Full Branch Review

Run exactly one full-branch review. Do not fix findings, commit, push, or rerun the review.

The review and publication are separate steps:

1. Produce the raw structured review result.
2. Unless `--skip-pr-comment` is present, publish each finding as a separate inline PR review comment at its reported code location.

Never publish an aggregate or top-level PR comment for the review result. When the review has no findings, publish nothing.

A caller such as `code-implement-loop` may invoke this skill with `--skip-pr-comment` and process the returned result itself.

## Input Contract

Infer the repository, branch, PR, and optional implementation-plan history from the current checkout.

Accept only one optional flag:

- `--skip-pr-comment`: return the raw review result without publishing inline comments to the PR.

Do not accept an implementation-plan-history path from the caller.

## 1. Run Preflight

Resolve repository context:

```bash
eval "$("$HOME/dotfiles/scripts/coding-preflight.mjs")"
cd "$worktree_root"
```

Require the helper to provide `inside_worktree`, `worktree_root`, `worktree_path`, `branch`, `repo`, `in_dd_scope`, `origin_branch_ref`, `origin_branch_exists`, `local_ahead_count`, and `origin_ahead_count`. If it fails, return `BLOCKED` with its stderr.

Select the existing zsh GitHub function from the exact repository owner:

```bash
repo_owner="${repo%%/*}"
if [[ "$repo_owner" == "ddoghq" ]]; then
  gh_function="gh-ddog"
else
  gh_function="gh-personal"
fi
```

Load the PR associated with the current branch:

```bash
if ! pr_meta_json="$(
  zsh -ic 'source "$HOME/dotfiles/zshrc"; "$@"' \
    full-branch-review-gh "$gh_function" pr view \
      --repo "$repo" "$branch" \
      --json number,url,baseRefName,headRefName,headRefOid
)"; then
  echo "BLOCKED: current branch has no associated PR"
  exit 1
fi

pr_number="$(jq -r '.number' <<<"$pr_meta_json")"
pr_url="$(jq -r '.url' <<<"$pr_meta_json")"
base_ref="$(jq -r '.baseRefName' <<<"$pr_meta_json")"
head_ref="$(jq -r '.headRefName' <<<"$pr_meta_json")"
head_sha="$(jq -r '.headRefOid' <<<"$pr_meta_json")"
```

Require a non-empty `pr_url`. Require `branch == head_ref` and `git rev-parse HEAD == head_sha`. Return `BLOCKED` with the exact mismatch otherwise.

Discover the current branch's committed implementation-plan history when it is available:

```bash
committed_plan_history_file="$(
  node "$HOME/dotfiles/claude-skills/code-implement-loop/scripts/implementation_plan_history.mjs" \
    committed-history-path \
    --worktree-root "$worktree_root" \
    --branch "$branch"
)" || committed_plan_history_file=""

if [[ ! -f "$committed_plan_history_file" || ! -s "$committed_plan_history_file" ]]; then
  committed_plan_history_file=""
fi
```

An unavailable or empty history is not a blocker. Continue the review using the PR title and body as the author-intent source.

When the history is available, pass its discovered path directly to the reviewer. Do not copy, rewrite, or delete the file.

## 2. Run One Full-Branch Review

Run the existing shared reviewer:

```bash
reviewer_args=(
  --worktree-root "$worktree_root"
  --repo "$repo"
  --branch "$branch"
  --pr-number "$pr_number"
  --pr-url "$pr_url"
  --base-ref "$base_ref"
  --gh-function "$gh_function"
)
if [[ -n "$committed_plan_history_file" ]]; then
  reviewer_args+=(
    --implementation-plan-history-file "$committed_plan_history_file"
  )
fi

full_review_result="$(
  node "$HOME/dotfiles/scripts/code-review/run_dual_pr_branch_review.mjs" \
    "${reviewer_args[@]}"
)"
```

Do not hand-edit `full_review_result`.

The reviewer fetches `origin/$base_ref`, revalidates the local branch and PR head, computes the merge base, and reviews the full local branch diff plus staged, unstaged, and untracked non-ignored changes. It uses the plan-history path when the file remains available. If the file disappears before a reviewer reads it, the reviewer continues with the PR title and body.

Parse the result as strict JSON and require:

- `status`: `approved`, `revise`, or `blocked`
- `findings`: an array
- `overall_explanation`: a non-empty string

Return `BLOCKED: full branch review returned invalid JSON` if the contract is invalid.

## 3. Publish Findings As Inline Comments

Skip this entire step when `--skip-pr-comment` is present.

If `findings` is empty, set `inline_comment_count=0` and `inline_review_url=""`, then continue to the return contract without calling GitHub.

For non-empty findings, require every `code_location.absolute_file_path` to be inside `worktree_root` and every line range to be valid. A finding's location must identify lines shown on the right side of the current PR diff. Return `BLOCKED: full branch review finding cannot be published inline` with the invalid location if validation fails. Do not move the finding to another line and do not fall back to a top-level comment.

Get the authenticated login so each inline comment follows the global pull request comment disclosure rule:

```bash
review_owner_login="$(
  zsh -ic 'source "$HOME/dotfiles/zshrc"; "$@"' \
    full-branch-review-gh "$gh_function" api user --jq '.login'
)"
```

Build one GitHub review request whose `comments` array has one entry per finding. Omit the review-level `body`; each comment carries the finding itself. Use the finding's repository-relative path and right-side line range exactly as returned:

```bash
worktree_prefix="$worktree_root/"
comment_disclosure="> _AI-generated comment (posted by an agent on behalf of @$review_owner_login)._"
inline_review_payload="$(
  jq -c \
    --arg commit_id "$head_sha" \
    --arg worktree_prefix "$worktree_prefix" \
    --arg disclosure "$comment_disclosure" \
    '
      {
        commit_id: $commit_id,
        event: "COMMENT",
        comments: [
          .findings[] |
          .code_location.line_range as $range |
          {
            path: (.code_location.absolute_file_path | ltrimstr($worktree_prefix)),
            line: $range.end,
            side: "RIGHT",
            body: ([$disclosure, "", "**\(.title)**", "", .body, "", "**Evidence:** \(.evidence)"] | join("\n"))
          }
          + if $range.start < $range.end then
              {start_line: $range.start, start_side: "RIGHT"}
            else
              {}
            end
        ]
      }
    ' <<<"$full_review_result"
)"
```

Submit the review once so GitHub either accepts the complete set of inline comments or rejects the request:

```bash
inline_review_result="$(
  zsh -ic 'source "$HOME/dotfiles/zshrc"; "$@"' \
    full-branch-review-gh "$gh_function" api \
      --method POST \
      "repos/$repo/pulls/$pr_number/reviews" \
      --input - <<<"$inline_review_payload"
)"
inline_comment_count="$(jq -r '.findings | length' <<<"$full_review_result")"
if ! inline_review_url="$(jq -er '.html_url | select(length > 0)' <<<"$inline_review_result")"; then
  echo "BLOCKED: full branch review findings were not published inline"
  exit 1
fi
```

Wait for the command. If it fails or does not return a non-empty `html_url`, return `BLOCKED: full branch review findings were not published inline` with the exact error. Do not rerun the review, retry publication, move comments, or fall back to a top-level comment.

## Return Contract

Always preserve `full_review_result` unchanged.

- Without `--skip-pr-comment`, report the raw review status, PR URL, inline comment count, and inline review URL when findings were published.
- With `--skip-pr-comment`, return the raw JSON result for the caller to process and state that inline comment publication was skipped.
