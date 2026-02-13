---
name: explore-intent
description: General exploration and intent-clarification workflow for investigating codebases with file:line evidence and producing either quick cited summaries or deep exploration reports.
---

# Explore and Clarify Workflow

## Purpose

Use this skill for repository exploration plus user-intent clarification before design or implementation.
Optimize for accurate, evidence-backed findings with output depth proportional to task complexity.

## Trigger Guidance

Use this skill when:

- The user asks how a subsystem works across files or services
- The user asks for architecture or data-flow mapping
- The user needs exploration before design or implementation planning
- The user asks for root-cause investigation that needs execution-path tracing
- The user asks for comprehensive findings with code citations

Do not use this skill when:

- The task is straightforward implementation with already clear requirements
- The task is a single-file refactor or mechanical edit
- The user asks generic Q&A that does not require repository exploration

## Output Modes

Choose one mode during intake:

| Signal | Mode |
|---|---|
| Narrow question and likely <= 5 key files | `quick` |
| Cross-cutting behavior, unclear boundaries, or > 5 files | `deep` |
| User explicitly asks for a report or document | `deep` |

Mode overrides:

- If user asks for "just a short answer" or "no files", force `quick`.
- If user asks for a written artifact under `exploration/`, force `deep`.

Mode precedence (highest first):

1. Explicit artifact requirement (`exploration/{slug}/FINDINGS.md`) -> `deep`
2. Explicit brevity/no-file request -> `quick`
3. Otherwise use the signal matrix

If the prompt contains conflicting instructions (for example, "short answer" and "write FINDINGS.md"), ask one clarifying question. If unanswered, default to `deep` and keep the final summary concise.

## Workflow

### Phase 0: Intake

1. Restate the exploration objective in one sentence.
2. Choose `quick` or `deep` mode.
3. Capture explicit scope and assumptions.

### Phase 1: Clarification (chat-first)

- Ask 1-3 high-impact questions per round when needed.
- Use `references/questioning-guide.md` to pick questions.
- If user does not answer, proceed with explicit assumptions.
- Create `exploration/{slug}/QUESTIONS-*.md` only when the user explicitly requests async file-based Q&A.

### Phase 2: Exploration and evidence collection

- Start from likely entrypoints and trace outward through calls and dependencies.
- Prefer fast search commands (`rg --files`, `rg "pattern"`).
- Keep an evidence ledger where each claim maps to inspected `file:line`.
- Track three buckets:
  - Observed facts
  - Inferences from observed facts
  - Unknown or unverified areas
- Stop condition for `quick`: once the objective is answered with sufficient cited evidence, stop exploring and synthesize.
- Stop condition for `deep`: cover all primary subsystems needed to answer the core exploration questions.
- No-evidence condition: if relevant code cannot be found after targeted entrypoint and keyword search, report what was searched, mark findings `Unverified`, and provide next search directions.

Before synthesis, apply `references/evidence-rules.md`.

### Phase 3: Synthesis and delivery

Quick mode output (chat):

1. Objective
2. Key findings with `file:line` citations, labeled `Observed`, `Inferred`, or `Unverified`
3. Open questions or uncertainty
4. Suggested next checks

Deep mode output (`exploration/{slug}/FINDINGS.md`):

1. Create `exploration/{slug}/` using kebab-case topic slug
2. Fill `exploration/{slug}/FINDINGS.md` using `references/findings-template.md`
3. Include architecture mapping and detailed findings with citations
4. Add a diagram only if it materially improves understanding
5. Ensure each major finding is labeled `Observed`, `Inferred`, or `Unverified`

## Evidence Standards

- Never cite a file or line that was not inspected in the current session.
- Every substantive claim must be cited or labeled `Unverified`.
- If evidence is missing or conflicting, state that directly and provide next checks.
- Never present inference as observed fact.

## Completion Checklist

- [ ] Output depth matches request complexity
- [ ] Objective is answered
- [ ] Claims are cited or marked `Unverified`
- [ ] Assumptions and unknowns are explicit
- [ ] Suggested next checks are provided when uncertainty remains
- [ ] Mode decision and any overrides are explicitly stated

## Reference Files

- `references/questioning-guide.md`
- `references/evidence-rules.md`
- `references/findings-template.md`
