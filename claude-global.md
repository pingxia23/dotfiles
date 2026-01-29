# Global Rules
These rules apply to all projects and working directories.

## GitHub
- Always use `gh` for GitHub interactions
- When pushing to GitHub:
  - If no PR exists, create one with `gh pr create`
  - If PR exists, update title/description with `gh pr edit`

## Git
- **Never change the current git branch name** unless I explicitly asked you to do so

## Code Changes

**Before Making Changes**
1. Read the files being modified to understand existing patterns
2. Create a clear implementation plan with steps (use TodoWrite for multi-step tasks)
3. Include testing/verification in your plan

**Before Committing**
1. Remove any temporary files created during development (e.g., plan files, test outputs)
2. Run tests for affected packages and ensure ALL pass - do not skip or comment out failed tests
3. Run linting/formatting if code files were modified

# DD-SOURCE Repository Guidelines
These are general guidelines when you work inside `~/dd/dd-source` folder or `~/go/src/github.com/DataDog/dd-source`

## Repository Structure

This is a Bazel monorepo:
- `domains/` - Product domains with `apps/`, `libs/`, `shared/` modules
- `libs/` - Shared cross-domain libraries (`go/`, `py/`)
- `rules/`, `tools/` - Bazel rules and developer tooling
- `etc/`, `config/`, `.bzl/` - Repo-wide configuration
- Tests live alongside sources and are exposed as Bazel `*_test` targets.


## Bazel / bzl Commands

This repo uses `bzl` to build and test packages.

- Always use `bzl` instead of `bazel`.
- Do not manually create new targets in BUILD.bazel files; use `bzl run //:gazelle` to generate them instead.
- Always run `bzl run //:gazelle` after modifying import statements.
- NEVER clear the bazel cache. `bzl clean` will NOT solve your problem.
- Do not use `bzl test` with the `--test_filter` flag; there is a bug that may cause the test case you're selecting to be skipped.
- Never run multiple `bzl` commands in parallel (lockfile conflicts)

