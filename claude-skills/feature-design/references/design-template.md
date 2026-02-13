# Feature Design: {Feature Name}

**Status:** Draft | In Review | Approved  
**Author:** {name}  
**Created:** {YYYY-MM-DD}  
**Last Updated:** {YYYY-MM-DD}

## 1. Purpose / Big Picture

Describe why this work matters from the user perspective. State what a user can do after this change that they cannot do today, and how that outcome can be observed.

## 2. Current State and Context

Describe how the system currently behaves, including relevant constraints.

Every substantive claim about the codebase must include a citation:
- Single line: `path/to/file.go:42`
- Range: `path/to/file.go:42-57`

Key files:
- `path/to/file:line` - what this file does today
- `path/to/file:line` - related dependency or integration

## 3. Goals and Non-Goals

### 3.1 Goals
- {goal}
- {goal}

### 3.2 Non-Goals
- {explicitly out of scope}
- {explicitly out of scope}

## 4. Proposed Design

### 4.1 Architecture Overview
Describe the intended architecture and major flows.

### 4.2 Data Model
Describe new or changed data structures and invariants.

### 4.3 Interfaces and Dependencies
List APIs, module boundaries, and type/interface contracts that must exist after implementation.

### 4.4 Component Behavior
Describe component-level responsibilities and important error paths.

### 4.5 State Transitions (if applicable)
Describe lifecycle/state transitions and invalid states.

## 5. Alternatives Considered

For each alternative, document:
- Description
- Pros
- Cons
- Why it was not chosen

## 6. Verification Strategy

Define how the design will be verified:
- Unit tests to add or modify
- Integration tests/fixtures/harnesses/e2e coverage
- Required test data and doubles/fakes
- Validation approach for relevant non-functional behavior

## 7. Implementation Roadmap

Roadmap rules:
- Milestone 1 is always **Integration Tests**.
- Each milestone should be independently verifiable.
- Sequence milestones by dependency order.
- Prefer one milestone per commit with green tests.

### Milestone 1: Integration Tests

**Goal:** {end-to-end behavior covered before or alongside implementation}  
**Files:** {test files/fixtures/harness paths}  
**Changes:** {what tests are added/updated}  
**Tests:** {specific test names or suites}  
**Verification:** `{exact command}`  
**Expected Result:** {what success looks like}

### Milestone N: {Name}

**Goal:** {what this milestone delivers}  
**Files:** {paths to create/modify}  
**Changes:** {specific edits/components}  
**Tests:** {unit/integration tests to add or modify}  
**Verification:** `{exact command}`  
**Expected Result:** {observable success signal}

## 8. Validation and Acceptance

Define acceptance as user-observable behavior:
- Scenario: {input/context}
- Action: {command/request/UI flow}
- Expected: {specific output/result}

If behavior is internal, specify tests that fail before and pass after.

## 9. Idempotence and Recovery

Document retry/rollback guidance:
- Which steps are safe to repeat
- What to do if a milestone fails midway
- How to recover without leaving the repo in a broken state

## 10. Decision Log

- Decision: {what was decided}
  Rationale: {why}
  Date/Author: {YYYY-MM-DD / name}

- Decision: {what was decided}
  Rationale: {why}
  Date/Author: {YYYY-MM-DD / name}

## 11. Assumptions

- {assumption}
- {assumption}

## 12. Open Questions

- [ ] {open question}
- [ ] {open question}

## 13. Evidence Snippets (Optional)

Include concise command output or snippets that support critical claims.
