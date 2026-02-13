# Deep Exploration Findings Template

Use this template for `deep` mode output in `exploration/{slug}/FINDINGS.md`.

```markdown
# Exploration Findings: {Topic}

## Original Prompt

{Exact user request}

## Scope and Assumptions

- Scope:
- Out of scope:
- Assumptions:

## Executive Summary

{2-4 sentence summary of the most important findings}

## System Map

{High-level architecture/data-flow explanation with citations}

{Optional diagram only if it adds clarity}

## Detailed Findings

### {Area 1}

- Finding: {statement} (`Observed` or `Inferred`)
- Evidence: `path/to/file.py:10-35`, `path/to/file2.go:90-120`
- Impact: {why this matters}

### {Area 2}

- Finding: {statement} (`Observed` or `Inferred` or `Unverified`)
- Evidence: `path/to/file.py:80-140`
- Impact: {why this matters}

## Answers to Exploration Questions

### Q1: {question}

Answer: {direct answer with citations}

### Q2: {question}

Answer: {direct answer with citations}

## Risks, Unknowns, and Conflicts

- {Unknown or conflict} (`Unverified`)
- Next check: {specific command/file/function to inspect}

## Key Files

| File | Lines | Why it matters |
|---|---|---|
| `path/to/file.py` | 10-35 | {purpose} |
| `path/to/file2.go` | 90-120 | {purpose} |

## Recommended Next Checks

1. {targeted next check}
2. {targeted next check}
```
