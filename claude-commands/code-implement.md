# Code Implementation

**Task:** $ARGUMENTS

---

## Mode Detection

Determine input type:
- If $ARGUMENTS contains `/` or ends with `.md` → **Document Mode**: Read and implement based on doc
- Otherwise → **Task Mode**: Implement the described task directly

## Context Gathering

1. Check for existing PR on current branch: `gh pr view --json url 2>/dev/null`
2. If PR exists, read previous implementations: `gh pr diff`
3. Understand what has already been implemented

## Implementation

**Requirements:**
- Follow TDD: write failing tests first, then implement
- Write elegant, minimal, modular code
- Adhere to existing code patterns and conventions
- Run verification commands if specified

**Quality Checklist:**
- [ ] Tests written before implementation (TDD)
- [ ] Tests pass
- [ ] Code follows existing patterns
- [ ] No unnecessary complexity

## Commit & Push

Use the **commit-smart** skill to:
- Run tests
- Stage changes (excluding working artifacts)
- Generate appropriate commit message
- Handle pre-commit hook failures
- Push to remote
- Create or update PR

## Failure Handling

If implementation fails:
1. Revert: `git checkout -- . && git clean -fd`
2. Retry ONCE with fresh approach
3. If still fails: Report FAILED, do NOT commit broken code

## Output

**Success:** SUCCESS: Implementation complete | Commit: {hash} | PR: {URL}
**Failure:** FAILED: {reason} | Changes reverted.

## Rules
- Never change the current git branch name
