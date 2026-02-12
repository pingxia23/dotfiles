# Evidence Rules

These rules prevent fabricated citations and overconfident conclusions.

## Claim types

Label each important statement as one of:

- `Observed`: directly supported by inspected code
- `Inferred`: conclusion derived from multiple observed facts
- `Unverified`: plausible but not yet confirmed in inspected code

## Citation format

Use repository-relative path and line references:

- Single line: `path/to/file.py:42`
- Range: `path/to/file.py:42-58`
- Function anchor: `path/to/file.py:42` (`function_name`)

## Verification protocol

Before citing:

1. Open the file in the current session.
2. Confirm the claim matches the cited lines.
3. Ensure path and line numbers are current in this session.

Never cite from memory or prior sessions.

## Minimum evidence bar

- Every substantive claim must have at least one citation.
- Cross-component claims should have citations from each relevant component.
- If no citation is available, mark the statement `Unverified`.

## Handling uncertainty

If evidence is insufficient or conflicting:

- State the uncertainty directly.
- Provide competing interpretations with supporting citations.
- List specific next checks that would resolve uncertainty.

## Forbidden behaviors

- Inventing files, symbols, or line numbers
- Presenting inferred behavior as direct observation
- Dropping citations for major claims to improve readability

## Final self-check

- [ ] All major claims are cited or marked `Unverified`
- [ ] No citation references uninspected files
- [ ] Inference statements are clearly labeled
- [ ] Unknowns and next checks are explicitly listed
