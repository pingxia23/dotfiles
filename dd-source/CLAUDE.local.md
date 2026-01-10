# Repository Guidelines

## Primary Domain
@domains/assistant/CLAUDE.md

I primarily work on the `domains/assistant` folder. When I ask about "assistant", I'm referring to services in this folder unless specified otherwise.

**Key reference:** See @domains/assistant/CLAUDE.md for domain-specific architecture, code style, and commands.

## Repository Structure

This is a Bazel monorepo:
- `domains/` - Product domains with `apps/`, `libs/`, `shared/` modules
- `libs/` - Shared cross-domain libraries (`go/`, `py/`)
- `rules/`, `tools/` - Bazel rules and developer tooling
- `etc/`, `config/`, `.bzl/` - Repo-wide configuration
- Tests live alongside sources and are exposed as Bazel `*_test` targets.


This repo uses `bzl` to build and test packages.
<bzl_tool_rules>
- Always use `bzl` instead of `bazel`.
- Do not manually create new targets in BUILD.bazel files; use `bzl run //:gazelle` to generate them instead.
- Always run `bzl run //:gazelle` after modifying import statements.
- NEVER clear the bazel cache. `bzl clean` will NOT solve your problem.
- Do not use `bzl test` with the `--test_filter` flag; there is a bug that may cause the test case you're selecting to be skipped.
- Never run multiple `bzl` commands in parallel (lockfile conflicts)
</bzl_tool_rules>

## Development Workflow
<development_workflow_rules>

**Before Making Changes**
1. Read relevant code and understand existing patterns
2. Create a clear implementation plan with steps
3. Include testing/verification in your plan


**Before Committing**
1. Remove any temporary files created during development
2. Ensure ALL tests in affected packages pass. You can not skip any failed tests
3. Run the following scripts
```bash
bzl run //:gazelle              # After modifying imports, adding or deleting files
bzl run //tools/format:lint_ruff
bzl run //tools/format:format_ruff
```
</development_workflow_rules>
