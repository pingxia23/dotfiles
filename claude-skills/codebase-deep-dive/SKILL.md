---
name: codebase-deep-dive
description: Deep-dive a software codebase to extract meaningful system decisions, architecture boundaries, and major user-visible/internal features, then write a research report file named rearch-{name}.md. For each key feature, produce a detailed section that covers design, components, and a code-backed ASCII diagram. Use when asked to understand an unfamiliar repository, summarize design intent from code and docs, identify decision rationale/tradeoffs, compare documented architecture vs implementation, or produce a concrete technical discovery report with code references.
---

# Codebase Deep Dive

## Overview

Extract what the system is, how it behaves at runtime, why it is shaped that way, and which capabilities matter most. Prioritize code-backed findings over speculative interpretation.

The report must read as a guided explanation, not an audit log. Teach the reader the system's purpose and runtime shape before presenting inventories, file lists, or detailed evidence.

## Reader-Focused Report Rules

These are hard requirements, not style preferences. If a draft violates them, rewrite it before delivery.

- Start with the main point. The reader should understand the system's purpose, runtime shape, and most important findings from the first few sections.
- Explain concepts in plain English before naming implementation types, files, or methods.
- Each major section must begin with a takeaway paragraph that states the conclusion directly.
- Prefer runtime walkthroughs over component catalogs. A deep dive should explain what happens first, second, and third.
- Evidence supports the explanation; it should not become the explanation.
- Keep `Scope and Evidence` near the end unless the user explicitly asks for audit-first output.
- Do not make the reader infer the main point from reviewed file lists, evidence bullets, tables, or diagrams.

Actionable writing rules:

- Lead with the user-visible or system-level behavior, then cite implementation.
  - Good: "The worker processes one job by loading its config, acquiring a lease, running handlers, and publishing a terminal event."
  - Avoid: "`Worker.run`, `LeaseManager`, and `EventPublisher` are the core classes."
- Name the lifecycle before naming the modules.
  - Good: "A request moves through auth, planning, execution, persistence, then notification."
  - Avoid: "The important files are `auth.py`, `planner.py`, `executor.py`, `store.py`, and `notify.py`."
- Make stop conditions explicit.
  - Good: "The loop stops when the model returns no tool calls, a client-side tool needs the browser, or the budget guard fires."
  - Avoid: "The loop continues until completion."
- Separate "why" from "how".
  - Good: "Decision: tool results are persisted before summarization so the system can recover full evidence later. Runtime: the summarizer stores the raw payload, inserts a compact message, and exposes a read-back tool."
  - Avoid: repeating the same tool-result flow in both the decision section and feature deep dive.
- Use evidence after the claim.
  - Good: "The service treats retries as part of the job lifecycle; `runner.go#L40-L85` wraps each handler call in `RetryPolicy.Execute`."
  - Avoid: a bullet list of files followed by "therefore this is the retry system."
- Keep inventories short.
  - Good: one table that orients the reader to capabilities and points to deep dives.
  - Avoid: long tables that duplicate the detailed sections.
- Write diagrams as explanations, not decorations.
  - Good: a diagram that shows entry point, loop, storage writes, emitted events, and stop paths.
  - Avoid: a diagram that only lists class names in boxes.

Before delivery, apply this quality gate:

- Can a new engineer explain the system's main runtime path after reading only `TL;DR`, `System Mental Model`, and `Runtime Walkthrough`?
- Does every major section state its conclusion before listing evidence?
- Are file lists and evidence blocks supporting material instead of the report's opening structure?
- Are repeated explanations collapsed into one best section with cross-references instead of copy-paste summaries?
- Are implementation details introduced only after the behavior they implement is clear?

## Workflow

1. Define scope first.
- Identify entry points, requested subsystems, and output audience.
- List directories/files that are likely authoritative for architecture and behavior.

2. Build a repository map.
- Identify runtime entry points, orchestration layers, core domain modules, infrastructure boundaries, and persistence/external integrations.
- Use fast code search (`rg`) and focused file reads.

3. Identify the main runtime lifecycle.
- For the primary path, capture a numbered walkthrough:
  - entry point,
  - setup/context loading,
  - core execution loop or handler flow,
  - external calls, tools, storage, or network boundaries,
  - stop/return conditions,
  - persistence, emitted events, or side effects,
  - cleanup or post-processing.
- This walkthrough should be plain English and appear before detailed component inventories in the report.

4. Extract system decisions.
- Identify decisions that materially shape behavior.
- For each decision, capture:
  - decision statement,
  - likely rationale from code/docs,
  - tradeoffs and constraints,
  - evidence links to code or ADRs.
- Keep decisions focused on why the system has its current shape. Do not repeat full feature walkthroughs here.

5. Extract feature and capability inventory.
- Group by capability domains (for example: context handling, tooling, execution, storage, safety, observability).
- Identify which features are key enough to deserve their own detailed section in the report.
- For each key feature, capture:
  - one-sentence takeaway,
  - what it does and why it matters,
  - design shape: control flow, data flow, boundaries, and lifecycle,
  - main components and their responsibilities,
  - a diagram plan rendered as ASCII in Markdown,
  - where implemented (file links),
  - notable limitations/gaps.
- Keep lightweight features in a compact inventory, but do not omit detailed sections for the features that materially define the system.
- After individual feature extraction, identify cross-cutting concerns that span multiple features (e.g., inconsistent error handling across subsystems, resource/size management differences between components, security boundary patterns, configuration propagation). Cross-cutting concerns that reveal inconsistencies or design debt deserve their own deep-dive sections.

6. Compare docs vs implementation.
- Validate whether ADR/docs match current behavior.
- Call out drift explicitly with concrete references.

7. Synthesize actionable improvements.
- Propose prioritized opportunities with expected impact and implementation landing zones.
- Keep proposals specific to current architecture.

8. Write the deliverable.
- Before drafting the report, read the `## Writing Style` section from your memory file and apply it throughout the document.
- Create exactly one report file named `rearch-<name>.md` in the current working directory unless the user requests a different location.
- Ensure every key feature has a dedicated section with `Takeaway`, `Design`, `Runtime Flow`, `Components`, and `Diagram` subsections.
- Use ASCII diagrams only. Never use Mermaid.

9. Validate readability and completeness.
- Confirm the first three content sections explain the system without requiring the reader to inspect code links.
- Confirm the runtime walkthrough names the real entry point, main loop/handler, stop conditions, and side effects when those concepts exist.
- Cross-reference the Architecture Snapshot diagram against Key Feature Deep Dives. Every named component or subsystem in the diagram should either have its own deep-dive section or be covered within another section.
- Cross-reference the Feature Inventory table: every row rated "High" or "Critical" gap should have a corresponding deep-dive section.
- If a component is intentionally omitted from deep dives, state why in the Gaps and Risks section.

## Output Contract

Write `rearch-<name>.md` with this structure:

1. `# Research: <topic>`
2. `## TL;DR`
- 3-5 bullets covering system purpose, runtime shape, and the highest-value findings.
- Use plain English; avoid leading with file names.
3. `## System Mental Model`
- Explain what the system is, what problem it solves, and how a reader should think about its boundaries.
- Introduce implementation names only after the conceptual shape is clear.
4. `## Walkthrough`
- Numbered step-by-step flow for the main path.
- Include entry point, setup, core loop/handler, external boundaries, stop/return conditions, and side effects where applicable.
5. `## Architecture Snapshot`
- concise system map and main components.
- include a top-level system diagram when it materially helps comprehension.
6. `## Load-Bearing System Decisions`
- one subsection per decision.
- each decision subsection should include:
  - `Takeaway`: one sentence naming the decision and why it matters.
  - `Rationale`: why the code/docs suggest this shape exists.
  - `Tradeoff`: what this choice makes easier and harder.
  - `Evidence`: compact links to the strongest code/doc sources.
- If a decision overlaps with a key feature, keep the decision short and put the end-to-end behavior in the feature deep dive.
7. `## Feature Inventory`
- grouped capabilities with a short summary of value and implementation links.
- Keep this compact. It orients the reader; it is not the main explanation.
8. `## Key Feature Deep Dives`
- one subsection per key feature.
- each feature subsection must include:
  - `#### Takeaway`
  - `#### Design`
  - `#### Runtime Flow`
  - `#### Components`
  - `#### Diagram`
  - `#### Implementation Evidence`
  - `#### Limitations / Open Questions`
- `Takeaway` should give the reader the main point before details.
- `Design` should explain how the feature behaves end-to-end, including boundaries and important data/control transitions.
- `Runtime Flow` should be a numbered list of what happens during execution.
- `Components` should name the concrete modules, classes, services, jobs, stores, or handlers involved and state each responsibility.
- `Diagram` should be an ASCII diagram in a fenced code block and should show the runtime interaction or data flow for that feature, not a generic box listing.
- Use monospaced boxes, arrows, labels, and boundary annotations where useful so the diagram is readable in plain Markdown.
- `Implementation Evidence` should link the primary code/doc sources that justify the section.
9. `## Cross-Cutting Concerns`
- include only when they materially explain the system or reveal design debt that spans multiple features.
10. `## Gaps and Risks`
- concrete issues, ambiguities, or design debt.
11. `## Recommended Next Steps`
- prioritized, implementation-oriented recommendations.
12. `## Scope and Evidence`
- repository/paths reviewed,
- constraints/assumptions,
- note whether the report is static reading, runtime tracing, tests, or a mix.

## Evidence Standards

- Ground every non-trivial claim in code or documentation.
- Prefer direct source links with file and line anchors.
- Distinguish facts from inference.
- Avoid vague summaries like "modular" or "scalable" without evidence.
- Keep the report concise and decision-oriented.
- Do not invent diagrams from guesswork; every node and edge in a feature diagram should be traceable to code or docs. Mark inferred edges explicitly.
- Use compact evidence blocks. Prefer the few strongest links over long source lists in the main sections; put broader reviewed-path lists in `Scope and Evidence`.
- Never use Mermaid. All diagrams must remain readable as plain ASCII text.

## Diagram Guidance

- Diagrams should show control flow, data flow, lifecycle, or ownership boundaries.
- Label entry points, loops, stop conditions, persistence points, external calls, and event/output sinks when they matter.
- Avoid diagrams that are only boxes of component names unless ownership is the main concept being explained.
- Keep diagrams readable in plain Markdown without horizontal scrolling when practical.

## Naming Guidance

- Use a short, stable slug for `<name>`, for example:
  - `rearch-assistant-architecture.md`
  - `rearch-tooling-pipeline.md`
  - `rearch-context-management.md`
