# Global Rules
These rules apply to all projects and working directories.

## Handle CLI command failures
- Proactively resolve CLI-related failures instead of asking the user to fix them. For example, if a CLI version is too old to be usable, install or upgrade to a newer version yourself rather than telling the user to do it.

## Handle no disk space failure
- When you encounter a `no space left on device` failure, launch a fresh sub-agent and use the `disk-pressure-recovery` skill to reclaim disk space before continuing.

## GitHub / Git 
- Always use `gh` for GitHub interactions
- Never resolve Github PR comments
- **ONLY** address unresolved Github comments
- **Never change the current git branch name** unless I explicitly asked you to do so
- NEVER force push unless I explicitly asked you to do so

## Code Commit 
1. Remove any temporary files created during development (e.g., plan files, test outputs)
2. **ALWAYS** use `commit-smart` skill to commit
3. **NEVER** commit without Git signing enabled. If a commit hangs, retry once. If it still does not work, stop and ask the user for help.


## Python Code Style
1. **ALWAYS** perfer top-level import than inline import
2. Absolute imports only, never relative.
3. Mock with `patch.object()` on imported modules, not long path strings.

## Bazel / bzl Commands

Our codebase uses `bzl` to build and test packages.

- Always use `bzl` instead of `bazel`.
- Do not manually create new targets in BUILD.bazel files; use `bzl run //:gazelle` to generate them instead.
- Always run `bzl run //:gazelle` after modifying import statements.
- Never run multiple `bzl` commands in parallel (lockfile conflicts)
- Always print `bzl` output 

## Scope Control
**Primary Rule**
  - Keep plans tightly focused on the user’s explicit request.
  - Implement only the approved plan.

**What Not To Add**
  - Do not add refactors, abstractions, cleanup, extra wiring, or behavior changes unless they are required to complete the requested
    work.
  - Do not include adjacent improvements, opportunistic fixes, or “while we’re here” changes unless the user explicitly approves them.
**How To Handle Gaps**
  - If something necessary is missing, make the smallest change needed to unblock the planned work.
  - If a required change would materially expand scope, stop and surface it instead of proceeding on your own.
  - Decision Check Before Changing Anything
  - Before making any change, ask: is this required to complete the approved scope?
  - If not, leave it out.

# Plan Mode Output Template

  When writing a final proposed plan, follow this structure by default. Only omit a section when it would add no useful information for a trivial change. The goal is to make the proposed plan **easy to review and understand**.

  ```markdown

  ## Problem
  Describe what is wrong or missing today.

  Describe the user-visible outcome the plan should achieve.

  ## Approach
  Explain why the proposed approach fits the current codebase.

  If there is a meaningful alternative that is not being used, explain why.

  ## Implementation
  List the implementation changes before describing validation.

  Group changes by subsystem or behavior, not by file list.

  For each major change, use this shape:

  - Change: <what will change>
    Why: <why this is needed>
    How: <high-level implementation approach, using text plus pseudocode or an ASCII diagram when it makes the approach easier to review>

  Mention file paths only when they help locate the work or prevent ambiguity.

  Do not write this section as a line-by-line diff.

  Include relevant edge cases, failure modes, and compatibility concerns.

  ## Validation
  List the specific tests, commands, or manual checks that should prove the change works.

  ## Assumptions and Risks
  List assumptions made by the plan.

  List remaining risks or review points.
  ```

  

# Skill Routing Override

- If the current working directory is within `~/dd` (or its resolved absolute path), and the latest assistant response proposed an implementation plan and the user replies with `implement this`, `implement it`, `implement the proposed plan`, `carry out the plan`, or equivalent, treat that reply as an explicit invocation of `code-implement-loop`.
- This override takes precedence over generic default behavior such as "assume the user wants implementation."
