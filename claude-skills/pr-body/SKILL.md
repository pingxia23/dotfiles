---
name: pr-body
description: "Create or update the managed GitHub PR body for a PR URL. Use when a workflow needs to initialize or refresh the managed TL;DR, Problem, Approach, Review Guide, and optional Dev Test sections on an existing PR."
---

# PR Body

Create or update the managed body for an existing GitHub PR.

## Workflow

Input: a PR URL.

1. Identify the repository from the URL and load the PR title, body, commits, and files:

   ```bash
   gh pr view --repo "$repo" "$pr_url" --json title,body,commits,files
   ```

   Apply **Preserve existing content** below. Skip a non-empty body without the managed marker.

2. Inspect the full change:

   ```bash
   gh pr diff --repo "$repo" "$pr_url"
   ```

   Trace the affected scenario before and after the change. Inspect callers, surrounding code, and the base version when needed. Use the PR records and code as evidence; do not invent intermediate steps. Collect affected areas, review concerns, and recorded test commands and results for **Review Guide**, plus any qualifying development-test records for **Dev Test** below.

3. Read the `## Writing Style` section in your memory file. Draft the managed sections using **Body format**, then splice them into the original body using **Preserve existing content**.
4. Read the draft as an engineer new to the repository. Check that the before and after flows cover the same scenario, explain unfamiliar terms, and show the failure and correction without repeated prose. Check that unrelated content is unchanged. Revise any part that fails these checks.
5. Save the complete body to a file and publish it:

   ```bash
   gh pr edit --repo "$repo" "$pr_url" --body-file "<body-file>"
   ```

Return one of:

- `UPDATED: PR body updated | PR: <url>`
- `SKIPPED: existing PR body is manually edited | PR: <url>`
- `BLOCKED: PR body update failed | PR: <url> | Error: <summary>`

## Body format

Use this template for the body structure and the example below as the model for the finished writing. For a new body, use this section order. Omit the entire Dev Test section unless it qualifies under the rules below. Assume the reviewer knows software engineering but does not know the repository.

````markdown
<!-- ping-xia-pr-body:v1 -->

## TL;DR

<main behavior change and why it matters>

## Problem

<one or two sentences stating the current problem, its impact, and the triggering scenario or report>

```text
<current call path or user experience: trigger -> relevant steps -> failure -> outcome>
```

## Approach

<one or two sentences stating the change and how it solves the problem>

```text
<corrected flow for the same scenario: trigger -> relevant steps -> correction -> outcome>
```

## Review Guide

<short explanation of the dependency or impact chain and where reviewers should start>

<details>
<summary><b>1. <affected area and relevant package or path></b></summary>

**What changed:** <concrete change and why it is needed, with links to relevant code>

**Impact lineage:** <source of change -> affected contract or behavior -> affected area>

**What to scrutinize:**

- <specific behavior, constraint, or risk to check>

**How this was tested:**

```bash
<recorded test command>
```

</details>

## Dev Test

- [<tested scenario> — <telemetry type>](<actual telemetry URL>)
````

### TL;DR

State the observable behavior change and its value in no more than three sentences. Include a scope boundary when needed to prevent a mistaken assumption. Leave out implementation details, review guidance, and file lists.

### Problem and Approach flows

Treat these as a matched pair. Introduce each flow in one or two sentences, then let the flow carry the explanation. A call path is the sequence of calls between functions or components; a user experience is the sequence of actions and outcomes seen by the user.

- **Problem:** show the triggering input or action, the relevant steps, the failure or missing behavior, and its impact. Describe the current behavior; reserve the solution for Approach.
- **Approach:** state the change and how it solves the problem directly under `## Approach`, then show the corrected steps and outcome for the same input or action. Do not add subsection headings.
- Make a short ASCII diagram, numbered sequence, or worked example the main explanation. Put component roles, key values, and the failure or correction beside the relevant steps. Define unfamiliar names on first use; a code identifier alone is not a definition.
- Do not repeat the flow in surrounding paragraphs. Add only context the visual cannot show clearly. For a simple change with no useful multi-step flow, a concrete sentence is enough.

### Review Guide

Place `## Review Guide` after Approach and before Dev Test. Follow the numbered, collapsed area blocks in the [reference PR's reviewer guide](https://github.com/ddoghq/dd-source/pull/126839). Keep the format self-contained as shown in the template; the reference illustrates it.

Start with a short explanation of the dependency or impact chain and where to begin reviewing. Group changes by affected package, component, or team responsibility in numbered `<details>` blocks, without an `open` attribute. Use one block for a small change. Explain each area's role; a package name or path alone is not enough.

Each block contains:

- **What changed:** explain the concrete change and why it is needed. Link to relevant files or code locations in the PR's repository and revision so reviewers can inspect it.
- **Impact lineage:** show how the change reaches this area, using a short `source -> changed behavior or contract -> affected area` chain. This is the chain of effects, not a commit history.
- **What to scrutinize:** give specific review checks for behavior, constraints, or risks. Identify mechanical changes as such instead of inventing risks. Add a small diagram or pseudocode only when it helps assess a concern.
- **How this was tested**: include recorded commands. If execution evidence is unavailable, do not invent a command or imply tests passed.

Keep each block focused on what its reviewer needs to inspect, without repeating the full Problem or Approach. Test commands and results belong here; the optional Dev Test section remains limited to qualifying telemetry links.

## Preserve existing content

A body is managed only if it is empty or starts with:

```html
<!-- ping-xia-pr-body:v1 -->
```

Otherwise, skip the update. For an empty body, initialize this marker followed by a blank line. For a managed body, use the original text as the base; do not regenerate the whole body.

Only replace the managed sections. Match section headings exactly; a section ends at the next heading starting with `## ` or at the end of the body.

| Section | If present | If absent |
| --- | --- | --- |
| `## TL;DR` | Replace the full section. | Insert after the marker and its following blank lines. |
| `## Problem` | Replace the full section. | Replace legacy `## Context` with Problem; if neither exists, insert after TL;DR. |
| `## Approach` | Replace the full section. | Insert after Problem. |
| `## Review Guide` | Replace the full section. | Insert after Approach, before Dev Test. |
| `## Dev Test` | Replace or remove according to the rules below. | Append only when the rules below qualify it. |

Keep Dev Test last when included. Preserve every byte outside the managed sections and any migrated legacy Context section, except for the blank-line separator needed when appending Dev Test. Do not edit or reorder other content.

## Dev Test

Include this section only when execution records show a Rapid test drive (`rapid td` commands) or a Hotdog deployment (`hotdog-deploy`) for this PR, and an actual telemetry link is available. Telemetry is a record of the tested system's execution, such as an LLM Observability trace recording a language model's execution.

The section contains only direct links to telemetry from that qualifying run. Label each link with the tested scenario and telemetry type, using the format in the body template.

Use links from the conversation, command output, or retrieved telemetry records. Keep earlier links only if they meet these rules; remove duplicates and unrelated entries. Do not invent URLs, use generic landing pages, or include commands, deployment instructions, or expected-versus-observed summaries.

If no qualifying run or telemetry link is available, omit the section and remove any existing managed Dev Test section. Do not leave an empty heading or placeholder.

## Examples

### Fix Python investigation completion status


````markdown
## TL;DR

Fix Python investigations being marked inconclusive even when the agent found a valid conclusion.

## Problem

In the [reported staging investigation](https://dd.slack.com/archives/C0BLQUB68GJ/p1790813614511069), `e26ea5d0-4ad1-4421-9ffe-38aa00cc20d2` (organization 607371), the Python agent found a valid conclusion, but the final event caused the investigation to be marked inconclusive.

```text
Python agent finds a valid conclusion
  +-> StepHighlySupportedHypothesis (Go record of the finding)
  |     -> Kafka auditor (Go event publisher) ignores this step
  |     -> Its conclusion flag stays false: only successful publication of
  |        StepReactConclusion (Go conclusion step) sets it true
  +-> Coordinator (Go component that ends the investigation): conclusive=true
        -> Finish (completion call) receives no conclusion result
        -> Kafka auditor uses its own false flag
        -> InvestigationFinished (final event): conclusive=false
        -> Investigation is marked inconclusive
```

## Approach

Use the coordinator's conclusion result in the final event so valid Python conclusions are marked conclusive.

```text
Python agent finds a valid conclusion
  +-> StepHighlySupportedHypothesis (Go record of the finding)
  |     -> Kafka auditor (Go event publisher) still ignores this step
  +-> Coordinator (Go component that ends the investigation): conclusive=true
        -> Finish (completion call) now receives conclusive=true
        -> Shared auditor forwards the result to each auditor
        -> Kafka auditor uses the supplied result instead of its own flag
        -> InvestigationFinished (final event): conclusive=true
        -> Investigation is marked conclusive
```

## Review Guide

Start with the coordinator, the component that ends the investigation, then follow its conclusion result through the auditors that publish investigation events.

<details>
<summary><b>1. Investigation completion and event publication</b></summary>

**What changed:** `Finish`, the completion call, now receives the coordinator's conclusion result. The shared auditor forwards it to each auditor, and the Kafka auditor uses it to set `InvestigationFinished.Conclusive`, the final event's conclusion status.

**Impact lineage:** coordinator's conclusion result -> Finish argument -> shared auditor -> Kafka auditor -> final event's conclusion status

**What to scrutinize:**

- The conclusion result reaches every auditor without changing its value.
- A valid Python conclusion sets the final event's conclusion status to true even when the Kafka auditor did not publish a separate conclusion event.
- `Success`, the field that reports whether execution finished without an error, remains independent of conclusion status.

**How this was tested:** No execution evidence is available in this example.

</details>

````
