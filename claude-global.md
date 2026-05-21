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

## Understanding / Investigation
- Prefer codebase evidence first for understanding and investigation tasks.
- If codebase evidence is missing, weak, or not enough to support a conclusion, also search Atlassian MCP for supporting context.
- Ground conclusions in concrete code references, Atlassian references, or both. State which source supports each important claim.

## Explanation Style
- **ALWAYS** prefer pseudocode, example walkthroughs, and diagrams over prose.

## Bazel / bzl Commands

Our codebase uses `bzl` to build and test packages.

- Always use `bzl` instead of `bazel`.
- Do not manually create new targets in BUILD.bazel files; use `bzl run //:gazelle` to generate them instead.
- Always run `bzl run //:gazelle` after modifying import statements.
- Never run multiple `bzl` commands in parallel (lockfile conflicts)
- Always print `bzl` output 
- Stop and notify user whenever bzl command waits for OIDC device auth

# Implementation Discipline
Implement only the approved plan.

## Simplicity First
Minimum code that solves the problem. Nothing speculative.
- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## Surgical Changes
Touch only what you must. Clean up only your own mess.

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

## Handling Gaps
- If something necessary is missing, make the smallest change needed to unblock the planned work.
- If a required change would materially expand scope, stop and surface it instead of proceeding on your own.
- Before making any change, ask: is this required to complete the approved scope? If not, leave it out.

## Compatibility Discipline
- Do not add backward-compatibility scaffolding for code, schema fields, proto tags, APIs, or behaviors introduced only in the current PR. Before reserving proto tags, preserving old names, adding compatibility shims, or avoiding renumbering, verify the thing existed in the base branch or has already shipped. If it only exists in the current PR, remove or rewrite it cleanly instead of carrying speculative compatibility baggage.

## Python Code Style
1. **ALWAYS** prefer top-level import than inline import
2. Absolute imports only, never relative.
3. Mock with `patch.object()` on imported modules, not long path strings
4. Prefer Parametrized tests.

# Skill Routing Override
- **ALWAYS** `code-implement-loop` skill to implement a plan, if the current working directory is within `~/dd` (or its resolved absolute path), and the latest assistant response proposed an implementation plan and the user replies with `implement this`, `implement it`, `implement the proposed plan`, `carry out the plan`, or equivalent.

# Plan Mode Output Template

When writing a final proposed plan, follow this structure by default. Only omit a section when it would add no useful information for a trivial change. The goal is to make the proposed plan **easy to review and understand**.

```markdown

## Problem
Describe what is wrong or missing today.

Describe the user-visible outcome the plan should achieve.

## Approach
Explain why the proposed approach fits the current codebase.

If there is a meaningful alternative that is not being used, explain why.

For any factual claim about existing behavior, caching, performance, safety, or why a change can be avoided, include hard evidence from the repo when available. Cite concrete files, symbols, tests, or observed command output. Do not use words like "likely", "probably", or "should be fine" as justification unless they are explicitly marked as assumptions or risks.

When evidence exists, state both:
- Evidence: <specific code path, file, symbol, test, or command output>
- Conclusion: <what that evidence proves, and any remaining inference>

## Implementation
Describe the implementation changes before validation.

For each major change, use this format:
- Change: <what will change>
  Why: <why this is needed>
  How: <high-level implementation approach, using pseudocode or an ASCII diagram whenever possible>

Rules:
- Group changes by subsystem or behavior, not by file list.
- **Strongly** prefer pseudocode or ASCII diagrams for non-trivial logic, data flow, sequencing, or state transitions.
- Mention file paths only when they help locate the work or remove ambiguity.
- Do not describe the plan as a line-by-line diff.
- Do not write no-op `Change:` entries such as `Change: no change needed` or `Change: leave X unchanged`; omit them or state the scope boundary in Approach or Assumptions.

## Validation
List the specific tests, commands, or manual checks that should prove the change works.

## Assumptions / Agreements
- List explicit user preferences, scope boundaries, accepted risks, non-goals, and compatibility decisions before proposing mechanics.
- Separate confirmed agreements from open assumptions. Use this shape when useful:
  - `Agreement`: `<explicit user preference or constraint>`.
  - `Assumption`: `<inference that still needs confirmation or evidence>`.
  - `Non-goal`: `<thing the ADR must not design or implement>`.
```
