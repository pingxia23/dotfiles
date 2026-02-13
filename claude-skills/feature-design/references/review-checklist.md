# Design Review Checklist

Use this checklist before finalizing `designs/{slug}/DESIGN.md`.

## Completeness

- [ ] Purpose is user-visible and concrete.
- [ ] Goals and non-goals are explicit and non-overlapping.
- [ ] All major requirements from clarification rounds are addressed.
- [ ] Open questions are explicit, bounded, and non-blocking or clearly blocking.

## Correctness and Feasibility

- [ ] Proposed design actually solves the stated problem.
- [ ] Dependencies and integration points are realistic for this repository.
- [ ] Failure modes are addressed for critical paths.
- [ ] Rollout/compatibility strategy is coherent.

## Evidence and Clarity

- [ ] Every substantive codebase claim has `path:line` citation.
- [ ] Terms are defined in plain language.
- [ ] The document is self-contained and understandable by a new engineer.
- [ ] Diagrams (if used) match the written design.

## Roadmap Quality

- [ ] Milestone 1 is Integration Tests.
- [ ] Each milestone has Goal, Files, Changes, Tests, Verification, Expected Result.
- [ ] Milestones are sequenced by dependency and risk.
- [ ] Verification commands are concrete and runnable.

## Acceptance and Safety

- [ ] Acceptance criteria are behavior-based and observable.
- [ ] Non-functional concerns are included only where design-relevant.
- [ ] Idempotence/recovery guidance exists for risky steps.
- [ ] Assumptions and decisions are documented.

## Final Gate

If any item is unchecked, revise the design before finalizing.
