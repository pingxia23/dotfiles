---
name: adr
description: Draft or revise Architecture Decision Records and design ADRs. Use when the user asks to create an ADR, update an existing ADR, write a design record, restructure an ADR, document architecture decisions, or turn a technical design discussion into a readable Markdown decision document with context, approach, component pseudocode, decisions, consequences, and evidence.
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
- Preserve worked examples when they clarify the design. Do not remove examples for brevity unless they are wrong or duplicated.

Default to a reader-first structure:

```markdown
# ADR-<number>: <Title>

## Metadata
## Pseudocode Note
## Context
## Approach
## <Component A> Design
## <Component B> Design
## Decisions
## Consequences
## Decision Log
## References
```

Omit sections that add no value for a small ADR, but keep `Context`, `Approach`, component design sections when there is non-trivial mechanics, and `Decisions`.

## Workflow

1. Establish scope.
- If updating an existing ADR, read the full ADR before editing.
- If creating a new ADR, inspect the local ADR directory, naming convention, and index before choosing a filename or ADR number.
- Identify whether the user wants doc-only work or implementation. If they asked for an ADR, do not change code unless explicitly requested.

2. Gather evidence.
- Prefer repo evidence first: current code paths, tests, existing docs, generated clients, API contracts, and nearby ADRs.
- For internal systems, use internal docs only when repo evidence is missing or too weak.
- Keep evidence compact. Use it to support claims, not as the document's opening structure.

3. Write the high-level approach before decisions.
- Start with the problem and the end-to-end design walkthrough.
- Use an ASCII flow diagram for the whole system when the ADR covers multiple components.
- Put component mechanics and pseudocode before the `Decisions` section.

4. Add component design sections.
- Use one section per meaningful component, boundary, endpoint, workflow, storage path, or background process.
- Name sections by behavior or component, for example:
  - `## Ingress Endpoint Design`
  - `## Workflow Design`
  - `## Persistence Callback Design`
  - `## Retry and Idempotency Design`
- Prefer pseudocode over prose for request handling, state transitions, retry loops, validation, and lifecycle logic.

5. Write decisions after the design walkthrough.
- Use decisions for the deeper rationale that shaped the design.
- Keep behavior out of decisions if it is already explained in the approach or component sections.
- Each decision should clearly state:
  - `Chosen`: what the design does.
  - `Rejected`: the main alternative, if meaningful.
  - rationale and tradeoff.
  - evidence or pointer to the component section when useful.

6. Finish supporting sections.
- Consequences: split into positive, negative, and risks when useful.
- Decision Log: record durable decisions, not every edit.
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

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| YYYY-MM-DD | <decision> | <rationale> |

## References

- `<path>`
- `<doc link>`
````
