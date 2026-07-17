# Plan Mode Guide

Use this guide when writing a final proposed plan unless the change is trivial.
The goal is to make the proposed plan easy to review and understand.

Before drafting this plan, read the `## Writing Style` section from your memory file and apply it to the generated prose.

```markdown

## Problem
- What is wrong or missing today.
- User-visible outcome the plan should achieve.

## Approach
- Why this approach fits the current codebase.
- Meaningful alternatives considered and why they are not used.

For factual claims about existing behavior, caching, performance, safety, or why a change can be avoided, cite concrete repo evidence or Atlassian context. Do not use words like "likely", "probably", or "should be fine" as justification unless explicitly marked as assumptions or risks.

Use this evidence shape when useful:
- Evidence: `<specific code path, symbol, test, command output, or Atlassian reference>`
- Conclusion: `<what the evidence proves, plus any remaining inference>`

## Implementation
If the plan touches more than one file, layer, or call boundary, open this section with a single ASCII diagram or pseudocode block showing the overall before/after flow across those boundaries. Write the per-change bullets after it, referencing the diagram instead of re-narrating the call chain in prose.

Group changes by subsystem or behavior, not file list.

Use this shape:
- Change: `<what changes>`
  Why: `<why needed>`
  How: `<one or two lines; point back to the diagram for control flow, add pseudocode only for logic the diagram doesn't cover>`

Rules:
- A multi-file or multi-layer plan without a leading diagram or pseudocode block is incomplete. Nested bullets describing changes across files are not a substitute, even if each bullet is accurate.
- Mention file paths only when useful.
- Do not describe the plan as a line-by-line diff.
- Omit no-op `Change:` entries.

## Validation
- List the specific commands and checks that will prove the change works.
- Every plan must cover automated unit tests and make a best effort to cover developer end-to-end tests:
  - Automated unit tests: name the exact test targets or commands and the behavior they verify.
  - Developer end-to-end tests (best effort): when practical, describe the workflow a developer will run against a realistic environment and the expected result. This often means deploying a Rapid test drive to staging, calling the affected API, and verifying its response and relevant side effects or telemetry.

## Assumptions / Agreements
- Agreement: `<explicit user preference or constraint>`.
- Assumption: `<inference that still needs confirmation or evidence>`.
- Non-goal: `<accepted scope boundary>`.
```
