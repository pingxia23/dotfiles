# Implementation Design: {Feature Name}

**Status:** Draft  
**Author:** {name}  
**Created:** {YYYY-MM-DD}  
**Last Updated:** {YYYY-MM-DD}

## Proposed Design

### Architecture Overview
Describe the intended architecture and major flows.

### Data Model
Describe new or changed data structures and invariants.

### Interfaces and Dependencies
List APIs, module boundaries, and type/interface contracts that must exist after implementation.

### Component Behavior
Describe component-level responsibilities and important error paths.

### State Transitions (if applicable)
Describe lifecycle/state transitions and invalid states.

## Verification Strategy

Define how the design will be verified:
- Unit tests to add or modify
- Integration tests/fixtures/harnesses/e2e coverage
- Required test data and doubles/fakes
- Validation approach for relevant non-functional behavior

## Implementation Roadmap

Roadmap rules:
- Milestone 1 is always **Integration Tests**.
- Each milestone should be independently verifiable.
- Sequence milestones by dependency order.
- Each milestone must produce one commit with green tests.

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

## Validation and Acceptance

Use this section as the final orchestrator-level gate after all milestones complete.
Do not treat this section as a milestone.

Define acceptance as user-observable end-to-end behavior:
- Scenario: {input/context}
- Action: {command/request/UI flow}
- Expected: {specific output/result}

If behavior is internal, specify tests that fail before and pass after.
