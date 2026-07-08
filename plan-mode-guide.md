# Plan Mode Guide

Use this guide when writing a final proposed plan unless the change is trivial.
The goal is to make the proposed plan easy to review and understand.

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
Group changes by subsystem or behavior, not file list.

Use this shape:
- Change: `<what changes>`
  Why: `<why needed>`
  How: `<high-level approach, with pseudocode or ASCII diagram for non-trivial logic>`

Rules:
- Prefer pseudocode or ASCII diagrams for non-trivial logic, data flow, sequencing, or state transitions.
- Mention file paths only when useful.
- Do not describe the plan as a line-by-line diff.
- Omit no-op `Change:` entries.

## Validation
- Specific tests, commands, or manual checks.

## Assumptions / Agreements
- Agreement: `<explicit user preference or constraint>`.
- Assumption: `<inference that still needs confirmation or evidence>`.
- Non-goal: `<accepted scope boundary>`.
```
