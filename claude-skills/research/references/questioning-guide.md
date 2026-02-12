# Clarification Guide

Use clarification only when ambiguity would materially change findings.

## When to ask questions

Ask clarification questions if any of these are true:

- Scope is ambiguous (multiple plausible subsystems)
- Success criteria are unclear (what "good research output" means)
- Depth is unclear (`quick` vs `deep`)
- Time or focus constraints are implied but not explicit

If the request is already specific and bounded, skip questions and start exploration.

## Question limits

- Ask at most 1-3 high-impact questions in the first round.
- Avoid broad surveys or long questionnaires.
- If unanswered, proceed with explicit assumptions.
- If mode conflict exists (`quick` vs `deep` signals), ask exactly one disambiguation question.

## High-impact question categories

1. Scope boundary
2. Primary question to answer
3. Depth/output preference
4. Priority subsystem if multiple areas are relevant

## Good question patterns

- "Should this focus on the runtime flow only, or also include deployment/configuration paths?"
- "Which answer matters most: where logic lives, how data flows, or why behavior changed?"
- "Do you want a quick cited summary or a full report under `research/{slug}/FINDINGS.md`?"

## Poor question patterns

- Questions answerable directly from repository inspection
- Questions that ask the user to design the investigation process in detail
- Multi-part questions that block progress

## Default assumptions if unanswered

When questions are unanswered, continue with these defaults:

- Scope: only code paths directly tied to the user's objective
- Depth: `quick` unless architecture-level ambiguity suggests `deep`
- Priority: runtime behavior over historical context

State these assumptions explicitly in the output.
