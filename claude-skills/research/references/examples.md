# Examples

## Trigger examples (should use this skill)

- "Research how authentication works end-to-end in this repo."
- "Trace the ingestion pipeline and explain data flow with citations."
- "Investigate why cache invalidation appears inconsistent across services."

## Non-trigger examples (should not use this skill)

- "Rename this function and update call sites."
- "Fix this failing unit test."
- "Add a new API endpoint for user profile update."

## Quick mode example shape

1. Objective
2. Key findings with citations
3. Open questions
4. Next checks

## Deep mode example shape

- `research/{slug}/FINDINGS.md` using `findings-template.md`
- Comprehensive architecture/system mapping
- Detailed area-by-area findings
- Explicit unknowns and next checks

## Example mode decisions

- "Where is auth token parsing done?" -> `quick`
- "How does request auth and policy enforcement work across services?" -> `deep`
- "Explain observability pipeline architecture" -> `deep`

## Dogfood notes from v1 dry run

- If the user asks for concise output, force `quick` even if scope is broad.
- If `quick` has enough cited evidence to answer the objective, stop exploring.
- Keep claim labels consistent across both modes (`Observed`, `Inferred`, `Unverified`).

## Dogfood notes from v2 dry run

### Scenario A (quick)

Prompt: "Where is auth token parsing done? Keep it short."

Expected behavior:

1. Choose `quick` (explicit brevity request).
2. Ask no clarification questions unless subsystem ambiguity is high.
3. Return concise findings with claim labels and citations.
4. Stop after objective is answered.

### Scenario B (deep)

Prompt: "Investigate why cache invalidation is inconsistent across services and write `research/cache-invalidation/FINDINGS.md`."

Expected behavior:

1. Choose `deep` (explicit artifact request).
2. Ask up to 3 high-impact questions only if scope boundaries are unclear.
3. Create the findings document using the deep template.
4. Label findings (`Observed`/`Inferred`/`Unverified`) and include next checks for uncertainty.
