---
name: commit-smart
description: Smart commit workflow that handles linter errors, commits, pushes, and creates/updates PR. Use this workflow **ONLY WHEN** the code changes are within ~/dd folder or its subfolders.
---

Perform a smart commit workflow that handles linter errors automatically.

## Important Rules
- NEVER use `--no-verify` to skip hooks
- NEVER force push
- Maximum 2 automatic retry attempts before asking user

## Step 0: Run tests
- Run bzl tests for affected packages and ensure ALL pass - do not skip or comment out failed tests

## Step 1: Stage and Analyze Changes
1. Run `git status` and `git diff` to understand all changes
2. Stage changes, excluding working artifacts:
   ```bash
   git add -A -- ':(exclude)designs/' ':(exclude)plans/' ':(exclude)research/'
   ```
   (Excludes designs/, plans/, and research/ directories - these are working artifacts, not code)

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

### PR Description Schema
Generate a PR description following this structure:

```
## Problem
<Why this change is needed - the business/technical problem being solved>

## Approach
<High-level solution and key design decisions>

## Tests
<High-level summary of test coverage>

## Breaking Changes (if applicable)
<List any breaking changes and migration steps>

## Related
<Links to related PRs, issues, or tickets>
```

### Example

```
## Problem
`BaseTool.requires_approval` is a static `ClassVar[bool]`, but `CallDatadogAPITool` needs
to support both read (no approval) and write (approval required) operations. The current
workaround of splitting into two tools (`call_datadog_api` and `call_datadog_write_api`)
confuses the LLM with redundant tool choices.

## Approach
Replace the boolean with a tri-state `ApprovalRequirement` enum: `NO`, `YES`, and `RUNTIME`.
When set to `RUNTIME`, the tool implements `requires_approval_with_args(tool_args)` to
determine approval dynamically based on HTTP method and endpoint.

## Tests
Added `TestApprovalRequirement` covering all three enum states and runtime resolution.

## Related
- Fixes #12345
- Related to #352441
```

### Commands
- If no PR exists: `gh pr create --title "<title>" --body "<description>"`
- If PR exists: `gh pr edit --body "<description>"`

## Complete

Smart commit workflow complete. Provide the PR link to the user.
