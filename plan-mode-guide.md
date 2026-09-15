# Plan Mode Guide

Use this guide for a final proposed plan unless the change is trivial.


**Before drafting the plan, read and apply the `## Writing Style` rules from the memory file. Apply those rules to every section of the plan, including pseudocode labels and validation steps.**

Keep the five-section output structure below. Use short bullets, not long paragraphs. Do not repeat information across sections. Prefer pseudocode to prose for behavior, data flow, conditions, state changes, and error paths. Use an ASCII diagram only when it explains ownership or structure better than pseudocode.

````markdown
## Problem

In one or two bullets, state:
- what is wrong or missing; and
- what outcome the user will see.

## Approach

Use one to three bullets to state the chosen approach and why it fits the current code. Mention an alternative only when it is a realistic option with an important tradeoff.

Support important claims about existing behavior, performance, caching, or safety with a code path, symbol, test, command result, or Atlassian reference. Clearly label any claim that is still an assumption.

## Implementation

Use pseudocode as the main explanation whenever the change affects behavior. Show the start, important calls or data changes, conditions, error paths, and final result. Do not repeat the pseudocode in prose.

For example:

```text
receive input
validate input
if invalid:
    return the existing error
call the service
store the result
return the result to the user
```

After the pseudocode, list only the required changes. Use one short bullet per behavior or subsystem. State the change and its reason in the same bullet. Do not create a file-by-file inventory. Mention a file path only when it helps locate the code.

For documentation or configuration changes with no control flow, use short bullets instead of forced pseudocode.

## Validation

List the exact commands and checks that prove the change works:
- Automated unit tests: name the test targets or commands and the behavior they verify.
- Developer staging test, when available: `Use the rapid td CLI to create a test drive and run the test.`

## Assumptions / Agreements

List only items that affect the implementation or scope:
- Agreement: an explicit user choice or constraint.
- Assumption: an unconfirmed fact that can change the plan.
- Non-goal: an explicit scope boundary.
````
