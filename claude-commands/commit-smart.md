---
description: Commit, auto-fix linter errors, and push to GitHub
---

Perform a smart commit workflow that handles linter errors automatically.

## Important Rules
- NEVER use `--no-verify` to skip hooks
- NEVER force push
- Maximum 2 automatic retry attempts before asking user

## Step 1: Stage and Analyze Changes
1. Run `git status` and `git diff` to understand all changes
2. Stage all changes: `git add -A`

## Step 2: Generate Commit Message and Commit
Based on the diff, generate an appropriate commit message that:
- Summarizes the nature of the changes (feature, fix, refactor, etc.)
- Focuses on the "why" not the "what"
- Follows the repository's existing commit message style

Commit using HEREDOC format:
```bash
git commit -m "$(cat <<'EOF'
Your commit message here
EOF
)"
```

## Step 3: Handle Pre-commit Hook Failures
If the commit fails:

### Auto-fixable (retry automatically):
- Hook output shows files were reformatted/modified
- Hook ran gazelle and updated BUILD files
- These are auto-staged by the hook, just retry the commit

### Requires User Input (STOP and ask using AskUserQuestion):
- **Mypy type errors** - errors containing "error:" with line numbers and type messages
- **Unfixable lint errors** - ruff errors that remain after formatting
- **Build failures** - bazel/bzl build errors
- **After 2 failed retry attempts** - something unexpected is wrong

When stopping for user input:
1. Show the exact error output
2. Explain what type of error it is
3. Ask if they want you to attempt a fix or handle it manually

## Push to GitHub
After successful commit:
```bash
git push
```

If push fails (e.g., remote has new commits), show the error and ask the user how to proceed.

## Step 4: Create Or Update PR in GitHub
- If no PR exists, create one with `gh pr create`
- If PR exists, update title/description with `gh pr edit`
