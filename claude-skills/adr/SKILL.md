---
name: adr
description: Draft Architecture Decision Records and design ADRs. Use when the user asks to create an ADR, update an existing ADR, write a design record, restructure an ADR, document architecture decisions, or turn a technical design discussion into a readable Markdown decision document with context, approach, component pseudocode, decisions, consequences, and evidence. Uncommitted drafts may be revised; changes to committed ADRs require a new ADR.
---

# ADR

## Overview

Write ADRs for reviewable design, not audit logs. The reader should understand the problem, the proposed architecture, the component mechanics, and the deeper decisions in that order.

## Hard Writing Rules

These are hard requirements. If a draft violates any of them, rewrite it before presenting or saving the ADR.

- Use `Context` for the existing system, its behavior, and the problem that motivates the change. From `Approach` onward, every section must focus on the system after the proposed change and the changes needed to reach it.
- From `Approach` onward, diagrams, pseudocode, and walkthroughs must describe the proposed system. Identify what will be added, changed, or removed; include unchanged behavior only when needed to understand the proposed flow. Keep comparisons with existing behavior brief, explicitly label them, and refer to `Context` for details. Apply this boundary to decisions, consequences, and reference annotations too, so readers can distinguish the proposal from what exists today.
- Strongly bias toward pseudocode, example walkthroughs, and ASCII diagrams. For any non-trivial control flow, state transition, retry path, validation path, lifecycle, or data movement, use pseudocode or a concrete walkthrough as the primary explanation; prose should only support or summarize it.
- When an ADR contains code blocks, add a short `## Pseudocode Note` near the top before the first code block. State that all code examples are pseudocode for control flow, ownership boundaries, and contracts, not exact implementation. Also label implementation-shaped code blocks with an in-block `# Pseudocode: ...` comment when useful.
- Use concrete names from the codebase only after explaining the behavior they implement. Do not open a section with a file list or component catalog.
- Ground non-trivial claims about existing behavior and constraints in concrete code or docs. Clearly identify proposed behavior as design intent; it does not need to exist in the code yet.
- Mark unverified premises, inferred behavior, and uncertain feasibility as assumptions or risks. Do not label an explicit design choice as an assumption merely because it is not implemented yet.
- Capture user-stated preferences, constraints, and accepted tradeoffs in `## Key Assumptions / Agreements` before `## Approach`. Treat these as design inputs, not optional commentary.
- Do not edit an ADR that has already been committed to git. To change a committed ADR, create a new ADR that references the older ADR and explains the relationship. An uncommitted draft may be revised in place, including during the review loop.
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
- If the request references an existing ADR, read it in full before deciding whether to revise the uncommitted draft or create a new ADR that references it.
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
- Apply the writing instructions supplied in the conversation and applicable `AGENTS.md` files. If an identified memory file supplies additional writing rules, read and apply them too. Write for an engineer new to the repository: explain unfamiliar terms and connect each component to its purpose.
- Explain the existing system and problem in `Context`. Start `Approach` with the proposed end-to-end design and the changes required to implement it.
- Use an ASCII flow diagram for the system after the change when the ADR covers multiple components.
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

8. Review and revise the ADR.
- Check every section from `Approach` onward for a clear focus on the proposed system and required changes. Move extended descriptions of existing behavior to `Context`; label any essential brief comparisons and ensure diagrams, pseudocode, and examples show the proposed behavior.
- After saving the draft, set `adr_path` to the draft's absolute path and run the ADR plan-review script from the repository root. It uses the [shared reviewer configuration](../../scripts/reviewer_config.mjs) and requires Node.js plus the configured `pi` command-line tool and provider access. Reviewers inspect evidence and return feedback; they must not edit the draft or repository.

```bash
adr_review_result="$(
  node "$HOME/dotfiles/claude-skills/adr/scripts/run_adr_plan_review.mjs" \
    --worktree-root "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" \
    --adr-path "$adr_path"
)"
printf '%s\n' "$adr_review_result"
```

- Parse `adr_review_result` as strict JSON with:
  - `status`: `approved` when at least one valid review exists and all valid reviews approve; `revise` when valid reviews contain actionable comments; `blocked` when no valid review is available or the script fails.
  - `comments`: concrete review feedback.
  - `overall_explanation`: review summary.
  - `reviewers`: reviewer status map (`approved`, `revise`, or `unavailable`). Approval may have partial coverage; report any unavailable reviewers and their reasons from `overall_explanation`.
- Run at most two review rounds:
  1. If `status` is `approved`, finish with the current ADR.
  2. If `status` is `revise`, verify each comment against repository evidence and the proposed contracts, then edit the draft to address every valid comment. Do not expand the user's scope or change an explicit agreement only because a reviewer suggests a different design.
  3. After the first revision, run the script once more.
  4. If the second review requests revision, address its valid comments once, then stop. Do not request a third review. State that the final edits were not reviewed again; do not claim approval of that final draft.
- If the JSON is invalid or `status` is `blocked`, keep the draft, stop the review loop, and tell the user that automatic review did not complete. Include `overall_explanation` when available. Do not claim that the ADR was approved.
- In the final response, state whether the review approved the ADR, caused revisions, or could not complete.

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

Explain the existing system, the problem, and why the change matters. Keep detailed descriptions of existing behavior here.

Include concise evidence:

- `<file or doc>` proves `<fact>`.
- `<file or doc>` proves `<fact>`.

## Key Assumptions / Agreements

- **Agreement**: <explicit user preference or constraint that the design must honor>.
- **Agreement**: <accepted tradeoff or scope boundary>.
- **Assumption**: <inference that needs confirmation or evidence>.
- **Non-goal**: <thing this ADR must not design or implement>.

## Approach

Describe the system after the proposed change in plain English. Identify what must be added, changed, or removed. This focus applies to every section below.

Show the proposed end-to-end flow:

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

State the proposed core contract in one or two paragraphs.

## <Component A> Design

Explain the component's role after the change and the changes required to implement it.

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

Explain the component's role after the change and the changes required to implement it.

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

Explain why the chosen design meets the proposed system's needs and agreed constraints. Keep any necessary comparison with existing behavior brief and explicitly labeled. Reference component sections instead of repeating full mechanics.

### D2: <Decision>

**Chosen**: <chosen design>.

**Rejected**: <alternative>, if relevant.

Explain tradeoffs and constraints.

## Consequences

Describe the benefits, costs, and risks of the proposed system and the work required to reach it.

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
