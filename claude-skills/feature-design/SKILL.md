---
name: feature-design
description: Plan-mode workflow for turning a feature request into a decision-complete DESIGN.md with phased implementation milestones, strict file:line citations, and a review pass.
---

# Feature Design (Plan-Mode, PLANS-Inspired)

## Purpose

Use this skill to create a self-contained, implementation-ready feature design document.
The output should be understandable to an engineer with no prior context beyond the repository.

Primary output: `designs/{slug}/DESIGN.md`

This skill borrows from `PLANS.md` principles: self-contained specs, observable outcomes, explicit decisions, and milestone-level verification.

## Trigger Guidance

Use this skill when the user asks to:

- Design a feature or architecture change
- Create an implementation plan with milestones
- Run discovery and Q&A before implementation
- Produce a design doc for handoff

Do not use this skill when:

- The user asks for immediate coding with no design phase
- The change is a trivial one-file edit
- The task is pure investigation with no design artifact (use `explore-intent`)

## Non-Negotiable Rules

- Complete the exploration and clarification workflow from `explore-intent` before drafting `DESIGN.md`.
- Do not duplicate exploration/questioning mechanics in this skill; defer to `explore-intent`.
- Every substantive codebase claim must include `path:line` citations.
- Roadmap milestone 1 must always be **Integration Tests**.
- Describe acceptance as observable behavior, not just code edits.
- Record explicit assumptions and decisions in `DESIGN.md`.
- Keep the design self-contained; do not depend on undocumented prior context.

## Workflow

### Phase 0: Intake

1. Restate the objective in one sentence.
2. Derive a kebab-case slug from the feature request.
3. Set output path: `designs/{slug}/DESIGN.md`.

Create `designs/{slug}/REQUIREMENTS.md` only if the user explicitly asks for a separate Q&A artifact.

### Phase 1: Grounding (Explore First)

Run `explore-intent` first and follow it as the source of truth for:
- Exploration process
- Questioning discipline
- Evidence labeling and citation rules

### Phase 2: Clarification (Intent and Tradeoffs)

From the `explore-intent` output, lock:
- Confirmed behavior and boundaries
- Key tradeoffs and constraints
- Remaining unknowns, assumptions, and risks

Only proceed when the design is decision-complete for implementation planning.
If the user stops responding, continue with explicit assumptions in `DESIGN.md`.

### Phase 3: Draft DESIGN.md

Fill `designs/{slug}/DESIGN.md` using `references/design-template.md`.
Make the document self-contained and implementation-ready.

### Phase 4: Review Pass

Run the checklist in `references/review-checklist.md`.
Apply improvements directly to `DESIGN.md`.
Move unresolved concerns into Open Questions.

## Quality Bar

A complete design must:
- Be implementable without additional product decisions
- Provide dependency-correct milestone ordering
- Include files, tests, commands, and expected outcomes per milestone
- Define acceptance in behavior terms
- Make assumptions, decisions, and unknowns explicit

## Completion Output

Ensure `designs/{slug}/DESIGN.md` exists and is complete.
Then output:

`Design complete. Ready for implementation: designs/{slug}/DESIGN.md`

## Reference Files

- `references/design-template.md`
- `references/review-checklist.md`
- `references/milestone-examples.md`
- `../explore-intent/references/questioning-guide.md`
- `../explore-intent/references/evidence-rules.md`
