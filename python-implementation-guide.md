# Python Implementation Guide

Use this guide when writing or changing Python code.

## Scope

- Prefer the smallest implementation that solves the approved task.
- Match the surrounding module's style before introducing a new pattern.
- Do not create a helper, class, fixture, abstraction, option, or compatibility shim for a single caller unless the local code already uses that pattern or the complexity is real.
- Keep tests close to the behavior being changed.

## Imports And Dependencies

- Use top-level imports unless importing at module load time would create a real cycle or optional dependency failure.
- Use absolute imports only; do not use relative imports.
- Remove imports made unused by your change.
- After changing `.py` imports or dependencies in a Bazel repo, run `bzl run //:gazelle`.
- Do not add a third-party dependency when the standard library or an existing dependency is enough.

## Structure

- Put public behavior before private helpers when that matches the existing file.
- Keep functions focused on one behavior, but do not split straight-line logic into helpers just to make the file look organized.
- Prefer explicit data flow over hidden mutation.
- Avoid broad "utils" placement unless the repo already has a clear owner for that shared behavior.

## Types And Data Shapes

- Preserve existing type annotation style in the touched module.
- Add type annotations when they clarify a changed boundary, public function, dataclass, or test fixture.
- Prefer simple built-in containers and dataclasses over custom classes unless behavior needs to live with the data.
- Do not introduce compatibility aliases or duplicate field names for code that only exists in the current PR.

## Errors And Logging

- Handle errors that can actually occur at the changed boundary.
- Do not add defensive handling for impossible states unless the existing API contract is ambiguous.
- Raise specific exceptions or return existing local error types; avoid broad `except Exception` unless the surrounding code already treats a boundary that way.
- Preserve existing logging style. Do not add noisy logs just to show control flow.

## Tests

- Prefer parametrized tests for repeated input/output cases.
- Test the behavior or contract, not private implementation details.
- Include edge cases that are part of the approved behavior.
- Avoid snapshot-style assertions when a direct assertion would be clearer.
- Keep test fixtures small and local unless multiple tests genuinely share the setup.

## Mocking

- Prefer `patch.object()` on imported modules or objects instead of long string patch paths.
- Patch the boundary the code under test actually calls.
- Keep mocks narrow: assert the important interaction, not every incidental call.
- Prefer fakes or plain test data when they make the behavior easier to understand than mocks.
