# Global Rules
These rules apply to all projects and working directories.
## Writing Style

### Audience
Write for an SDE I who is new to the repository and does not know its internal services, architecture, abbreviations, or advanced domain concepts. 

### Guidance
- Give enough context for the reader to understand what is happening, why it matters, how the relevant pieces connect, and what to do next without needing outside explanation.
- ALWAYS prefer concrete language. Use ASD-STE100 Simplified Technical English whenever possible
- Use established domain terminology when it is the most precise choice, and briefly define it when the intended audience may not know it.
- Do not rewrite code, identifiers, commands, quoted text, or prescribed formats merely to satisfy this style rule.

### Best Practices
- Prefer a useful visual over a wall of text:
  - Use an ASCII diagram for call chains, data flow, or component ownership.
  - Use pseudocode for control flow.
  - Use a table to compare approaches.
  - Use a truth table or branch sketch for conditional behavior.
- Prefer a worked example over a list of file references. Show the input, intermediate state, and output.
- When explaining a decision, state the choice, the reason, and the important tradeoff.

### Readability Check
Before finalizing, read the response as an engineer who has not seen the codebase. Rewrite it if the reader cannot answer:
1. What is happening or changing?
2. Why does it matter?
3. How do the relevant pieces connect?


## Handle CLI command failures
- Proactively resolve CLI-related failures instead of asking the user to fix them. For example, if a CLI version is too old to be usable, install or upgrade to a newer version yourself rather than telling the user to do it.

## GitHub / Git 
- Use `gh` for GitHub.
- Before running GitHub commands, identify the repository's exact owner. `DataDog` and `ddoghq` are distinct owners; Use `gh-ddog` for `ddoghq/*` repositories. Use `gh-personal` for `DataDog/*` and personal repositories. 
- Never use `gh auth switch`; it changes global state and can affect other terminals or agents.
- Only address unresolved PR comments; never resolve PR comments.
- Use this exact template for all agent-authored pull request comments, including top-level comments, review-thread replies, and inline comments. Replace `@username` with the authenticated GitHub login:

  ```markdown
  > _AI-generated comment (posted by an agent on behalf of @username)._

  <comment body>
  ```

  Do not add this disclosure to a pull request description that the user reviewed before submission.
- Do not rename the current branch or force-push unless explicitly asked.
- Use normal `git commit`; never use low-level git plumbing. Use `--no-verify` only when explicitly asked.
- Always create commits through the normal `git commit` path. Never create commits with low-level plumbing such as `git commit-tree`, `git hash-object`, `git update-ref`, or manual `.git` metadata edits.

## Investigation
- Prefer codebase evidence first; use Atlassian Confluence doc and Datadog Telemetry when code evidence is missing or weak.
- Ground important claims in concrete code references, Atlassian references, Datadog Telemetry or command output.

## Bazel / bzl Commands
Our codebase uses `bzl` to build and test packages.
- Always use `bzl` instead of `bazel`.
- Do not manually create new targets in BUILD.bazel files; use `bzl run //:gazelle` to generate them instead.
- Always run `bzl run //:gazelle` after modifying import statements.
- Never run multiple `bzl` commands in parallel (lockfile conflicts)
- Always print `bzl` output 
- Stop and notify user whenever bzl command waits for OIDC device auth

# Implementation Discipline
Implement only the approved plan. Before making any change, ask: is this required to complete the approved scope? If not, leave it out.

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

## Python Code Style
- When writing or changing Python code, read `$HOME/dotfiles/python-implementation-guide.md`.

# Skill Routing Override
- **ALWAYS** `code-implement-loop` skill to implement a plan, if the current working directory is within `~/dd` (or its resolved absolute path), and the latest assistant response proposed an implementation plan and the user replies with `implement this`, `implement it`, `implement the proposed plan`, `carry out the plan`, or equivalent.

## Plan Mode Output Template
- When writing a final proposed plan, read `$HOME/dotfiles/plan-mode-guide.md` and follow the template/guidance there.
