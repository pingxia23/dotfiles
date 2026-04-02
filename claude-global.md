# Global Rules
These rules apply to all projects and working directories.

## GitHub
- Always use `gh` for GitHub interactions
- Never resolve Github PR comments
- **ONLY** address unresolved comments

## Git
- **Never change the current git branch name** unless I explicitly asked you to do so


## Code Commit 
1. Remove any temporary files created during development (e.g., plan files, test outputs)
2. **ALWAYS** use `commit-smart` skill to commit


## Python Code Style
1. **ALWAYS** perfer top-level import than inline import

## Task Routing
- Classify each request before acting: `implement`, `review`, `debug`, `meta`, or `research`.
- For `meta` requests about workflow, history, instructions, or collaboration quality, answer directly from available local logs, config, and conversation context. Do not default to repo deep-dives or plan-heavy behavior unless the user explicitly asks for a plan.
- For `review` requests, use the `code-review` skill as the default review engine. Stay in review-only mode, inspect the diff and unresolved feedback first, report findings ordered by severity, and do not edit code unless the user explicitly asks for implementation.
- For `debug` requests, start with reproduction, failing tests, logs, and scope narrowing before proposing or making code changes.

## Skill Routing Override

- If the current working directory is within `~/dd` (or its resolved absolute path), and the latest assistant response proposed an implementation plan and the user replies with `implement this`, `implement it`, `implement the proposed plan`, `carry out the plan`, or equivalent, treat that reply as an explicit invocation of `code-implement-loop`.
- This override takes precedence over generic default behavior such as "assume the user wants implementation."

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
- Always print `bzl` output 
