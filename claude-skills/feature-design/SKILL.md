---
name: feature-design
description: Feature design planning workflow that turns a feature request into clarified requirements, a structured design document, and a review pass. Use when asked to design a feature, write an architecture/design doc, plan a new system/component, or run a discovery/Q&A phase before implementation.
---

# Feature Design Planning Workflow

## Overview

Guide a feature request from discovery through a formal design document and a review pass, producing `designs/{slug}/REQUIREMENTS.md` and `designs/{slug}/DESIGN.md`.

## Setup

1. Derive a kebab-case slug from the feature description (e.g., "user authentication system" → `user-auth-system`)
2. Create directory: `designs/{slug}/`
3. Create `designs/{slug}/REQUIREMENTS.md` with the original feature request

---

## Phase 1: Discovery & Clarification

Before designing, fully understand the problem space and constraints.

**Exploration Process:**

- Analyze relevant parts of the existing codebase using Read, Glob, Grep tools
- Identify existing patterns, conventions, and architectural decisions
- Map out integration points and dependencies
- Note constraints (technical, business, performance)

**If the feature is clear and well-scoped:**
- Skip to Phase 2 after brief exploration
- Document any assumptions in REQUIREMENTS.md

**If the feature needs clarification:**
- Add questions to REQUIREMENTS.md
- Wait for user answers, then append answers to REQUIREMENTS.md

**What to clarify:**

- **Functional requirements**: What exactly should this feature do?
- **Non-functional requirements**: Performance, scalability, security constraints?
- **Scope boundaries**: What's in vs. out of scope?
- **User personas**: Who uses this and how?
- **Integration**: How does this interact with existing systems?
- **Early testability constraints**: What test seams, fixtures, or harnesses must exist to verify the feature?
- **Success criteria**: How do we know when it's done right?

**Quality of questions matters:**

- Ask about specific behaviors (e.g., "When a user does X, should the system respond with Y or Z?")
- Ask about edge cases (e.g., "What happens when the input exceeds 10MB?")
- Ask about constraints (e.g., "Is there a latency budget for this API?")
- Ask about trade-offs (e.g., "Should we optimize for read performance or write consistency?")
- Be thorough - 5-10 well-thought-out questions is better than 2-3 vague ones

**ITERATIVE Q&A:**

- ASK AS MANY ROUNDS OF QUESTIONS AS YOU NEED
- Append each round of Q&A to REQUIREMENTS.md
- Only proceed to design when confident you understand the full scope
- It's BETTER to ask too many questions than to make assumptions

**REQUIREMENTS.md Template:**

```markdown
# Requirements: {Feature Name}

## Original Request

{The original feature request from the user}

## Assumptions

{Any assumptions made - update as needed}

## Q&A

### Round 1

**Q:** {Question}
**A:** {Answer}

{Add more rounds as needed}
```

---


## Phase 2: Design Document

Produce a comprehensive design document at `designs/{slug}/DESIGN.md`.

The design document has **8 sections**:
1. Overview (problem, goals, non-goals)
2. Background & Context
3. Proposed Design (architecture, data model, API, components)
4. Non-functional Considerations (performance, security, reliability)
5. Alternatives Considered
6. Verification Strategy
7. Implementation Roadmap
8. Open Questions

**All sections below are part of the DESIGN.md template.**

---

**CRITICAL: Citation Requirements**

Every code reference MUST include file path and line number:
- Single line: `path/to/file.py:42`
- Line range: `path/to/file.py:42-58`
- Function reference: `path/to/file.py:42` (the `function_name` function)

Examples:
```markdown
Authentication is handled in `apps/apis/assistant_api/main.py:85-120`
The token validation logic in `libs/py/request_context/auth.py:142` checks...
See the `validate_request` function at `internal/middleware/auth.go:67`
```

**Design Guidelines:**
- Follow established software engineering patterns (SOLID, DRY, separation of concerns)
- Match existing patterns and conventions in the codebase
- Prefer simplicity over cleverness

**Design Document Structure:**

```markdown
# Feature Design: {Feature Name}

**Status:** Draft | In Review | Approved
**Author:** {name}
**Created:** {date}
**Last Updated:** {date}

## 1. Overview

### 1.1 Problem Statement
{What problem does this feature solve?}

### 1.2 Goals
- {Primary goal}
- {Secondary goals}

### 1.3 Non-Goals (Out of Scope)
- {What this feature explicitly does NOT do}

## 2. Background & Context

### 2.1 Current State
{How does the system work today? Include citations.}

Key files:
- `path/to/file.py:10-50` - {description}

## 3. Proposed Design

### 3.1 Architecture Overview

{The overview of the design and the key design decisions}

{If Posssible, use mermaid diagram to show the architecture}

### 3.2 Data Model

{New or modified data structures}

{Use mermaid diagram to show the relationships among data models}

### 3.3 API Design

{New or modified APIs, with details on the endpoint, request, resopnse format}


### 3.4 Component Design

{Detailed design of each component}

{Use mermaid diagram to show the relationships among data models}

### 3.5 State Machine (if applicable)

{Use mermid diagram to show the state transitions}

## 4. Non-functional Considerations

{Consider performance, reliability, security, backward compatibility}

{Don't make this a laundary list. Only list the considerations that influenced the design decisions}

## 5. Alternatives Considered
List all alternatives considered, their pros and cons and why not chosen.

## 6. Verification Strategy

Explain how the proposed design will be verified in code. Include:
- Unit tests to add/modify (what behavior they verify)
- Integration tests/fixtures/harnesses/e2e suites to add/modify (what end-to-end flows they verify)
- Test data setup and any required test doubles or fakes
- How to validate non-functional requirements (performance, reliability, security) where applicable

## 7. Implementation Roadmap

**Important**: this section needs to be very detailed and specific, following the template defined for each milestone.
**Important**: the first milestone shall **ALWAYS** be the integration tests milestone, based on Section 6 Verification Strategy. 


### Milestone: Integration Tests

**Goal:** Add or update integration coverage for the full feature flow
**Files:** {Integration test files, fixtures, harnesses, or e2e suites to create or modify}
**Integration Tests:** {Specific integration tests to add/modify; include file paths and test names}
**Verification:** {How to run the integration test suite(s)}


### Milestone 2: {Milestone Name}

**Goal:** {What this milestone achieves}
**Files:** {Files to create or modify}
**Unit Tests:** {Unit tests to add/modify for this milestone; include file paths and test names}
**Verification:** {How to verify - test command or manual check}

### Milestone N: {Milestone Name}

{Add as many milestones as needed}

**Goal:** {What this milestone achieves}
**Files:** {Files to create or modify}
**Unit Tests:** {Unit tests to add/modify for this milestone; include file paths and test names}
**Verification:** {How to verify - test command or manual check}


**Roadmap Guidelines:**
- Each milestone = one commit with all tests passing
- High-risk milestones should come early (fail-fast)
- Dependencies must be sequenced correctly
- Always include the final integration-test milestone, even if integration tests are named as fixtures, harnesses, or e2e suites in this repo

## 8. Open Questions

- [ ] {Question that still needs answering}
- [ ] {Another open question}
```
---

## Phase 3: Design Review

Run an unbiased review pass.

- If a fresh sub-agent or reviewer workflow is available, use it to review `REQUIREMENTS.md` and `DESIGN.md` and apply edits directly to `DESIGN.md`.
- If no sub-agent is available, perform a self-review with the same checklist and update `DESIGN.md` accordingly.

**Sub-agent trigger (when available):**
Use the environment's sub-agent tool to run a separate reviewer. If the tool name is unknown, search the available tools list first. Use this prompt:

```text
You are an experienced engineer conducting a design review.

**Read these files:**
1. designs/{slug}/REQUIREMENTS.md (original request, assumptions, Q&A)
2. designs/{slug}/DESIGN.md (the design to review)

**Review checklist:**
- Completeness: All requirements addressed? Edge cases handled?
- Correctness: Design solves the problem? Assumptions valid?
- Clarity: Understandable? Diagrams accurate? Terms defined?
- Feasibility: Can be implemented? Dependencies available?
- Scalability: Handles expected load? Growth path clear?
- Security: Auth addressed? Data protected? Input validated?
- Maintainability: Follows patterns? Testable? Observable?
- Simplicity: No over-engineering? YAGNI followed?

**Your task:**
DIRECTLY EDIT DESIGN.md to fix issues and improve the design:
- Fix any issues you find
- Add missing details
- Improve clarity
- Move unresolved concerns to "Section 8: Open Questions"

Be critical but constructive. The goal is a better design.
```


## Complete

When complete, ensure `designs/{slug}/` contains:

| File | Purpose |
|------|---------|
| `REQUIREMENTS.md` | Original request, assumptions, Q&A |
| `DESIGN.md` | Comprehensive design document (reviewed and finalized) |

Say: "Design complete. Ready for implementation: `designs/{slug}/DESIGN.md`".
