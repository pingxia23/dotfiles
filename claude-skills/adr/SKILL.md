---
name: adr
description: Draft Architecture Decision Records and design ADRs. Use when the user asks to create an ADR, update an existing ADR, write a design record, restructure an ADR, document architecture decisions, or turn a technical design discussion into a readable Markdown decision document with context, approach, component pseudocode, decisions, consequences, and evidence. This skill always creates a new ADR; existing ADRs are references only.
---

# ADR

## Overview

Write ADRs for reviewable design, not audit logs. The reader should understand the problem, the proposed architecture, the component mechanics, and the deeper decisions in that order.

## Hard Writing Rules

These are hard requirements. If a draft violates any of them, rewrite it before presenting or saving the ADR.

- Strongly bias toward pseudocode, example walkthroughs, and ASCII diagrams. For any non-trivial control flow, state transition, retry path, validation path, lifecycle, or data movement, use pseudocode or a concrete walkthrough as the primary explanation; prose should only support or summarize it.
- When an ADR contains code blocks, add a short `## Pseudocode Note` near the top before the first code block. State that all code examples are pseudocode for control flow, ownership boundaries, and contracts, not exact implementation. Also label implementation-shaped code blocks with an in-block `# Pseudocode: ...` comment when useful.
- Use concrete names from the codebase only after explaining the behavior they implement. Do not open a section with a file list or component catalog.
- Ground every non-trivial claim in concrete code or docs. If evidence is missing, mark the statement as an assumption or risk.
- Mark assumptions explicitly. Do not present guesses, inferred behavior, or unverified future implementation details as facts.
- Capture user-stated preferences, constraints, and accepted tradeoffs in `## Key Assumptions / Agreements` before `## Approach`. Treat these as design inputs, not optional commentary.
- Always create a new ADR. Do not edit, revise, restructure, supersede in place, or append to an existing ADR. If the user asks to update or revise an ADR, create a new ADR that references the older ADR and explains the relationship.
- Do not add backward-compatibility scaffolding, migration logic, reserved fields, compatibility aliases, fallback behavior, or generalized extension points unless the section's assumptions/agreements or repo evidence explicitly require it.
- Preserve worked examples when they clarify the design. Do not remove examples for brevity unless they are wrong or duplicated.

Default to a reader-first structure:

```markdown
# ADR-<number>: <Title>

## Metadata
## Pseudocode Note
## Context
## Key Assumptions / Agreements
## Approach
## <Component A> Design
## <Component B> Design
## Decisions
## Consequences
## References
```

Omit sections that add no value for a small ADR, but keep `Context`, `Key Assumptions / Agreements`, `Approach`, component design sections when there is non-trivial mechanics, and `Decisions`.

## Workflow

1. Establish Scope

- Inspect the local ADR directory, ADR index, and existing naming/numbering convention before choosing a filename or ADR number.
- If the request references an existing ADR, read the full ADR and use it as evidence/context for the new ADR.
- Do not change code unless explicitly requested.
- Do not edit any ADR that has already been committed to git.
- If the relevant ADR has not been committed yet, it may be updated instead of creating a new ADR. Otherwise, always create a new ADR.


2. Gather evidence.
- Prefer repo evidence first: current code paths, tests, existing docs, generated clients, API contracts, and nearby ADRs.
- For internal systems, use internal docs only when repo evidence is missing or too weak.
- Keep evidence compact. Use it to support claims, not as the document's opening structure.

3. Capture key assumptions and agreements.
- List explicit user preferences, scope boundaries, accepted risks, non-goals, and compatibility decisions before proposing mechanics.
- Separate confirmed agreements from open assumptions. Use this shape when useful:
  - `Agreement`: `<explicit user preference or constraint>`.
  - `Assumption`: `<inference that still needs confirmation or evidence>`.
  - `Non-goal`: `<thing the ADR must not design or implement>`.
- If a future-proofing or compatibility change would contradict an explicit agreement, do not include it. Surface it as a risk or question instead.

4. Write the high-level approach before decisions.
- Before drafting the ADR, read the `## Writing Style` section from your memory file and apply it throughout the document.
- Start with the problem and the end-to-end design walkthrough.
- Use an ASCII flow diagram for the whole system when the ADR covers multiple components.
- Put component mechanics and pseudocode before the `Decisions` section.

5. Add component design sections.
- Use one section per meaningful component, boundary, endpoint, workflow, storage path, or background process.
- Name sections by behavior or component, for example:
  - `## Ingress Endpoint Design`
  - `## Workflow Design`
  - `## Persistence Callback Design`
  - `## Retry and Idempotency Design`
- Prefer pseudocode over prose for request handling, state transitions, retry loops, validation, and lifecycle logic.

6. Write decisions after the design walkthrough.
- Use decisions for the deeper rationale that shaped the design.
- Keep behavior out of decisions if it is already explained in the approach or component sections.
- Each decision should clearly state:
  - `Chosen`: what the design does.
  - `Rejected`: the main alternative, if meaningful.
  - rationale and tradeoff.
  - evidence or pointer to the component section when useful.

7. Finish supporting sections.
- Consequences: split into positive, negative, and risks when useful.
- Do not add a decision log by default. Use `Decisions` for rationale and `Key Assumptions / Agreements` for user preferences and accepted constraints.
- References: list the strongest code/doc sources.

## Output Contract

Use this template by default:

````markdown
# ADR-<number>: <Title>

## Metadata

- **Status**: Proposed
- **Date**: YYYY-MM-DD
- **Tags**: `<tag>`
- **Components**: `<component>`
- **Authors**: <team or owner>

## Pseudocode Note

All code examples in this ADR are pseudocode. They show intended control flow, ownership boundaries, and endpoint contracts, not exact implementation code. Names, imports, request fields, and helper functions should be adapted to the final code shape during implementation.

## Context

Explain the problem and why it matters.

Include concise evidence:

- `<file or doc>` proves `<fact>`.
- `<file or doc>` proves `<fact>`.

## Key Assumptions / Agreements

- **Agreement**: <explicit user preference or constraint that the design must honor>.
- **Agreement**: <accepted tradeoff or scope boundary>.
- **Assumption**: <inference that needs confirmation or evidence>.
- **Non-goal**: <thing this ADR must not design or implement>.

## Approach

State the high-level approach in plain English.

Show the end-to-end flow:

```text
caller
  |
  v
component A
  - responsibility
  - important boundary
  |
  v
component B
  - responsibility
```

State the core contract in one or two paragraphs.

## <Component A> Design

Explain the component's role.

```python
# Pseudocode: component A control flow.
def component_a_handler(req):
    validate(req)
    state = load_state(req.key)
    result = apply_design_rule(state, req)
    persist_or_emit(result)
    return accepted()
```

Call out important validation, state, retries, side effects, and stop conditions.

## <Component B> Design

Explain the component's role.

```python
# Pseudocode: component B workflow state and drain control flow.
class ComponentBWorkflow:
    def accept_update(self, update):
        if update.id in self.seen_ids:
            return duplicate()
        self.queue.append(update)
        self.seen_ids.add(update.id)

    async def run(self):
        while True:
            item = await next_item()
            await post_or_persist_with_retry(item)
            if item.is_terminal:
                return
```

## Decisions

### D1: <Decision>

**Chosen**: <chosen design>.

**Rejected**: <alternative>, if relevant.

Explain why the chosen design fits the current system. Reference component sections instead of repeating full mechanics.

### D2: <Decision>

**Chosen**: <chosen design>.

**Rejected**: <alternative>, if relevant.

Explain tradeoffs and constraints.

## Consequences

### Positive

- <benefit>

### Negative

- <cost or limitation>

### Risks

- <risk and mitigation>

## References

- `<path>`
- `<doc link>`
````
