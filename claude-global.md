# Global Rules

## GitHub
- Always use `gh` for GitHub interactions


## Git
- Never change the current git branch name

## Code Changes 

**Before Making Changes**
1. Read relevant code and understand existing patterns
2. Create a clear implementation plan with steps
3. Include testing/verification in your plan

**Before Committing**
1. Remove any temporary files created during development, such as your plan files.
2. Ensure ALL tests in affected packages pass. You can not skip any failed tests


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

