# Global Rules
These rules apply to all projects and working directories.

## Handle CLI command failures
- Proactively resolve CLI-related failures instead of asking the user to fix them. For example, if a CLI version is too old to be usable, install or upgrade to a newer version yourself rather than telling the user to do it.

## Handle no disk space failure
- When you encounter a `no space left on device` failure, launch a fresh sub-agent and use the `disk-pressure-recovery` skill to reclaim disk space before continuing.

## GitHub / Git 
- Use `gh` for GitHub.
- Only address unresolved PR comments; never resolve PR comments.
- Do not rename the current branch or force-push unless explicitly asked.
- Use normal `git commit`; never use low-level git plumbing. Use `--no-verify` only when explicitly asked.
- Always create commits through the normal `git commit` path. Never create commits with low-level plumbing such as `git commit-tree`, `git hash-object`, `git update-ref`, or manual `.git` metadata edits.

## Investigation
- Prefer codebase evidence first; use Atlassian Confluence doc and Datadog Telemetry when code evidence is missing or weak.
- Ground important claims in concrete code references, Atlassian references, Datadog Telemetry or command output.

## Explanation
- Make explanations easy to execute mentally. Lead with a visual before any file-by-file bullet list:
  - ASCII diagram showing call chain, data flow, or ownership.
  - Pseudocode showing the intended control flow.
  - A truth table or branch sketch for condition-heavy logic.
  - A concrete worked example with input, intermediate state, and output.
- A list of "file/function: change" bullets is never sufficient by itself for a multi-file or multi-layer change, even if each bullet is accurate. The visual comes first and carries the explanation; bullets may follow it only for mechanical specifics (exact signatures, flag names) the visual doesn't capture. If you catch yourself about to write nested bullets describing changes across more than one file, stop and draft the diagram or pseudocode first.
- When moving behavior between components, show the handoff explicitly:
  ```text
  before: caller -> old_owner -> result
  after:  caller -> new_owner -> result
  ```
- For condition-heavy changes, a truth table or branch sketch is required, not optional.

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
- When writing or changing Python code, read `$HOME/dotfiles/python-implementation-guide.md`.

# Skill Routing Override
- **ALWAYS** `code-implement-loop` skill to implement a plan, if the current working directory is within `~/dd` (or its resolved absolute path), and the latest assistant response proposed an implementation plan and the user replies with `implement this`, `implement it`, `implement the proposed plan`, `carry out the plan`, or equivalent.

## Plan Mode Output Template
- When writing a final proposed plan, read `$HOME/dotfiles/plan-mode-guide.md` and follow the template/guidance there.
