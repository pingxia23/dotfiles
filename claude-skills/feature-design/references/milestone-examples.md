# Milestone Examples

Use these as formatting and depth references when writing Section 7 (Implementation Roadmap).

## Example 1: Mandatory Integration Test Milestone

### Milestone 1: Integration Tests

**Goal:** Prove the end-to-end feature path with failing-then-passing integration coverage.  
**Files:** `domains/example/service/tests/feature_flow_test.go`, `domains/example/service/tests/testdata/feature_fixture.json`  
**Changes:** Add integration scenarios for success path, invalid input, and dependency timeout handling.  
**Tests:** `TestFeatureFlow_Success`, `TestFeatureFlow_InvalidInput`, `TestFeatureFlow_DependencyTimeout`  
**Verification:** `cd /repo && bzl test //domains/example/service/tests:all`  
**Expected Result:** New integration tests fail before implementation and pass after milestone completion.

## Example 2: Core Implementation Milestone

### Milestone 2: API and Service Wiring

**Goal:** Implement API handler and service path that satisfy integration contract.  
**Files:** `domains/example/service/api/handler.go`, `domains/example/service/core/feature_service.go`, `domains/example/service/core/feature_service_test.go`  
**Changes:** Add request validation, service call path, and error mapping to API response model.  
**Tests:** `TestFeatureService_ValidRequest`, `TestFeatureService_DependencyError`, `TestHandler_ValidationError`  
**Verification:** `cd /repo && bzl test //domains/example/service/core:all //domains/example/service/api:all`  
**Expected Result:** Unit tests pass and integration tests from Milestone 1 now pass.

## Example 3: Rollout and Compatibility Milestone

### Milestone 3: Controlled Rollout

**Goal:** Enable safe rollout while preserving compatibility for existing clients.  
**Files:** `domains/example/service/config/feature_flags.go`, `domains/example/service/api/handler.go`, `domains/example/service/tests/compat/legacy_client_test.go`  
**Changes:** Gate new behavior behind flag and preserve legacy response shape when flag is disabled.  
**Tests:** `TestLegacyClientBehavior_FlagOff`, `TestNewBehavior_FlagOn`  
**Verification:** `cd /repo && bzl test //domains/example/service/tests/compat:all`  
**Expected Result:** Legacy behavior remains unchanged by default; new behavior is exercised when flag is enabled.

## Notes

- Keep milestone text concrete and implementation-directed.
- Include file paths and test names, not broad placeholders.
- Verification should state exact commands and expected signals.
