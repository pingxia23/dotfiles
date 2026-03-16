---
name: codebase-deep-dive
description: Deep-dive a software codebase to extract meaningful system decisions, architecture boundaries, and major user-visible/internal features, then write a research report file named rearch-{name}.md. For each key feature, produce a detailed section that covers design, components, and a code-backed ASCII diagram. Use when asked to understand an unfamiliar repository, summarize design intent from code and docs, identify decision rationale/tradeoffs, compare documented architecture vs implementation, or produce a concrete technical discovery report with code references.
---

# Codebase Deep Dive

## Overview

Extract what the system is, why it is shaped that way, and which capabilities matter most. Prioritize code-backed findings over speculative interpretation.

## Workflow

1. Define scope first.
- Identify entry points, requested subsystems, and output audience.
- List directories/files that are likely authoritative for architecture and behavior.

2. Build a repository map.
- Identify runtime entry points, orchestration layers, core domain modules, infrastructure boundaries, and persistence/external integrations.
- Use fast code search (`rg`) and focused file reads.

3. Extract system decisions.
- Identify decisions that materially shape behavior.
- For each decision, capture:
  - decision statement,
  - likely rationale from code/docs,
  - tradeoffs and constraints,
  - evidence links to code or ADRs.

4. Extract feature and capability inventory.
- Group by capability domains (for example: context handling, tooling, execution, storage, safety, observability).
- Identify which features are key enough to deserve their own detailed section in the report.
- For each key feature, capture:
  - what it does and why it matters,
  - design shape: control flow, data flow, boundaries, and lifecycle,
  - main components and their responsibilities,
  - a diagram plan rendered as ASCII in Markdown,
  - where implemented (file links),
  - notable limitations/gaps.
- Keep lightweight features in a compact inventory, but do not omit detailed sections for the features that materially define the system.
- After individual feature extraction, identify cross-cutting concerns that span multiple features (e.g., inconsistent error handling across subsystems, resource/size management differences between components, security boundary patterns, configuration propagation). Cross-cutting concerns that reveal inconsistencies or design debt deserve their own deep-dive sections.

5. Compare docs vs implementation.
- Validate whether ADR/docs match current behavior.
- Call out drift explicitly with concrete references.

6. Synthesize actionable improvements.
- Propose prioritized opportunities with expected impact and implementation landing zones.
- Keep proposals specific to current architecture.

7. Write the deliverable.
- Create exactly one report file named `rearch-<name>.md` in the current working directory unless the user requests a different location.
- Ensure every key feature has a dedicated section with `Design`, `Components`, and `Diagram` subsections.
- Use ASCII diagrams only. Never use Mermaid.

8. Validate completeness.
- Cross-reference the Architecture Snapshot diagram against Key Feature Deep Dives. Every named component or subsystem in the diagram should either have its own deep-dive section or be covered within another section.
- Cross-reference the Feature Inventory table: every row rated "High" or "Critical" gap should have a corresponding deep-dive section.
- If a component is intentionally omitted from deep dives, state why in the Gaps and Risks section.

## Output Contract

Write `rearch-<name>.md` with this structure:

1. `# Research: <topic>`
2. `## Scope`
- repository/paths reviewed,
- constraints/assumptions.
3. `## Architecture Snapshot`
- concise system map and main components.
- include a top-level system diagram when it materially helps comprehension.
4. `## Meaningful System Decisions`
- one subsection per decision with rationale/tradeoffs and code/doc evidence.
- When analyzing for comparison with a reference system, end each decision subsection with a `**Comparison to [reference]:**` note explaining whether the reference system has an equivalent, and the gap.
5. `## Feature Inventory`
- grouped capabilities with a short summary of value and implementation links.
6. `## Key Feature Deep Dives`
- one subsection per key feature.
- each feature subsection must include:
  - `#### Design`
  - `#### Components`
  - `#### Diagram`
  - `#### Implementation Evidence`
  - `#### Limitations / Open Questions`
- `Design` should explain how the feature behaves end-to-end, including boundaries and important data/control transitions.
- `Components` should name the concrete modules, classes, services, jobs, stores, or handlers involved and state each responsibility.
- `Diagram` should be an ASCII diagram in a fenced code block and should show the runtime interaction or data flow for that feature, not a generic box listing.
- Use monospaced boxes, arrows, labels, and boundary annotations where useful so the diagram is readable in plain Markdown.
- `Implementation Evidence` should link the primary code/doc sources that justify the section.
7. `## Gaps and Risks`
- concrete issues, ambiguities, or design debt.
8. `## Recommended Next Steps`
- prioritized, implementation-oriented recommendations.

## Evidence Standards

- Ground every non-trivial claim in code or documentation.
- Prefer direct source links with file and line anchors.
- Distinguish facts from inference.
- Avoid vague summaries like "modular" or "scalable" without evidence.
- Keep the report concise and decision-oriented.
- Do not invent diagrams from guesswork; every node and edge in a feature diagram should be traceable to code or docs. Mark inferred edges explicitly.
- Never use Mermaid. All diagrams must remain readable as plain ASCII text.

## Naming Guidance

- Use a short, stable slug for `<name>`, for example:
  - `rearch-assistant-architecture.md`
  - `rearch-tooling-pipeline.md`
  - `rearch-context-management.md`
