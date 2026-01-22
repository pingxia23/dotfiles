# Repository Guidelines

## Repository Structure

This is a Bazel monorepo:
- `domains/` - Product domains with `apps/`, `libs/`, `shared/` modules
- `libs/` - Shared cross-domain libraries (`go/`, `py/`)
- `rules/`, `tools/` - Bazel rules and developer tooling
- `etc/`, `config/`, `.bzl/` - Repo-wide configuration
- Tests live alongside sources and are exposed as Bazel `*_test` targets.


This repo uses `bzl` to build and test packages.
**Important bzl rules**
- Always use `bzl` instead of `bazel`.
- Do not manually create new targets in BUILD.bazel files; use `bzl run //:gazelle` to generate them instead.
- Always run `bzl run //:gazelle` after modifying import statements.
- NEVER clear the bazel cache. `bzl clean` will NOT solve your problem.
- Do not use `bzl test` with the `--test_filter` flag; there is a bug that may cause the test case you're selecting to be skipped.
- Never run multiple `bzl` commands in parallel (lockfile conflicts)

## Domain Specific Guidance
I primarily work on the `domains/assistant` folder. When I ask about "assistant", I'm referring to services in this folder unless specified otherwise.

**MANDATORY PREREQUISITE - THIS IS A HARD REQUIREMENT**
Whenever working in `domains/assistant` domain, MUST follow the guidance and rules defined in the 
@~/go/src/github.com/DataDog/dd-source/domains/assistant/CLAUDE.md

