# Routing Rubric

Use this rubric to classify the planning outcome.

## Route: `narrow`

Classify as `narrow` only if all are true:

1. The plan is decision-complete (no unresolved placeholders like `{TODO}`, `TBD`, open questions, or missing interface decisions).
2. Milestone count is 1 or 2.
3. Estimated touched files are 5 or fewer and bounded.
4. No migrations, no cross-domain refactor, no multi-service rollout, and no compatibility transition plan required.

## Route: `large`

Classify as `large` if any `narrow` condition fails.

Also classify as `large` when:
- scope cannot be confidently bounded from the plan text,
- verification strategy is incomplete,
- milestone dependencies are unclear.

## Tie-breaker

If uncertain, choose `large`.

## Output format

Emit:
- `ROUTE: narrow`
or
- `ROUTE: large`

Then add a one-paragraph rationale with the exact rubric criteria used.
