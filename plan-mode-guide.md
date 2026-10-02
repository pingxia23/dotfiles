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

Break implementation into numbered steps in dependency or execution order. Give each step a short, action-oriented title and its own focused pseudocode block. Show that step's input, important calls or data changes, conditions, error paths, and result as applicable. Use `text` code fences for pseudocode.

Keep the required changes, reasons, and supporting code references directly under the step they explain. Use short bullets for details that the pseudocode does not express. Do not repeat the pseudocode in prose, combine the whole implementation into one large code block, or append a separate catch-all "Required changes" list.

For example:

**1. Validate the request**

```text
receive input
validate input
if invalid:
    return the existing error
pass validated input to execution
```

- Reuse the existing validator so the request keeps the same validation rules.

**2. Execute and return the result**

```text
receive validated input
call the service with validated input
store the result
return the result to the user
```

- Update the caller to pass validated input to the service.

Organize steps by behavior or subsystem, not by file. Mention a file path only when it helps locate the code. For documentation or configuration-only steps, show the proposed structure or field assignments in that step's block instead of inventing control flow.

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
