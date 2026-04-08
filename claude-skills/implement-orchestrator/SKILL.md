---
name: implement-orchestrator
description: Orchestrate implementation from a planning outcome through a persisted implementation document at `designs/{slug}/IMPLEMENTATION.md`, followed by milestone-by-milestone sub-agent execution. Use when a user provides a plan and asks for automatic staged delivery.
---

# Implement Orchestrator

## Overview

Implement a planning-to-implementation orchestrator:
- Always generate `designs/{slug}/IMPLEMENTATION.md`.
- Always convert the plan into dependency-ordered implementation steps.
- Always execute steps sequentially with fresh sub-agents, and each step is implemented by invoking `code-implement-loop` with milestone-specific input derived from the implementation doc.
- Always require each milestone sub-agent to return the final `code-implement-loop` output verbatim.
- Run `cmdi-test-drive` as the last step when working from the assistant domain root, unless the user explicitly opts out.

## Hard Rules

- Never change the current git branch name.
- Use `gh` for all GitHub interactions.
- If running in a git worktree, resolve and pin the GitHub repository explicitly:
  - run `gh repo view --json nameWithOwner -q .nameWithOwner` from the current worktree,
  - pass `--repo <owner/repo>` to subsequent `gh` commands.
- Address unresolved PR comments/findings only.
- Never use destructive cleanup commands (`git reset --hard`, `git checkout -- .`, `git clean -fd`).
- Preserve existing unrelated working tree changes.

## Input Contract

Accept one of:
1. Path to a markdown plan file.
2. Direct pasted planning outcome text (for example a `<proposed_plan>` block).

Normalization rules:
- If the user says `code-implementation-loop`, normalize to `code-implement-loop`.
- If input is missing, stop and return:
  - `FAILED: provide a planning outcome (markdown path or pasted plan text)`

## Workflow

### 1) Intake and parse planning outcome

- Read the plan source and extract:
  - goal summary
  - milestones
  - explicit file paths (if present)
  - unresolved placeholders/questions
  - verification commands

### 2) Build implementation doc

1. Derive slug from plan title (kebab-case).
2. Create `designs/{slug}/IMPLEMENTATION.md`.
3. Fill the document using `references/implementation-doc-template.md`.
4. Ensure the roadmap satisfies:
   - Milestone 1 is always `Integration Tests`.
   - Each milestone is independently verifiable.
   - Milestones are dependency-ordered.
   - Verification command and expected result are present for each milestone.
5. Ensure `## Validation and Acceptance` is present as a final end-to-end gate after all milestones, not a milestone itself.

### 3) Execute milestones

For each milestone in `designs/{slug}/IMPLEMENTATION.md`, in order:
1. Launch a fresh sub-agent.
2. Use milestone prompt from `references/subagent-prompts.md`.
3. Convert the milestone into direct `code-implement-loop` input:
   - use the implementation doc path,
   - identify the milestone by name,
   - include the exact milestone block,
   - instruct the sub-agent to implement only that milestone.
4. Instruct the sub-agent to execute `code-implement-loop` with that converted input, not to implement the milestone directly.
5. Require the sub-agent to return the final output from `code-implement-loop` verbatim:
   - success must match `SUCCESS: Implementation complete | PR: {url}`
   - blocked must match one of the `code-implement-loop` blocked formats
   - any wrapped, summarized, or commit-only success response is a failure to follow the contract
6. Enforce commit boundary per milestone:
   - capture `base_sha=$(git rev-parse HEAD)` before launch,
   - after success capture `head_sha=$(git rev-parse HEAD)`,
   - require exactly one new commit: `git rev-list --count ${base_sha}..${head_sha}` equals `1`
7. Wait for sub-agent completion and validate both:
   - the returned `code-implement-loop` output contract
   - the commit-boundary check
8. Stop immediately if a milestone is blocked, returns a non-contract output, or commit-boundary validation fails.

### 4) Test drive

Only run this step when the current working directory is the assistant domain root:
- `~/dd/dd-source/domains/assistant`
- or a resolved equivalent clone root for the same directory, such as `~/go/src/github.com/DataDog/dd-source/domains/assistant`

Treat this as the default last step after all milestones succeed and before returning final status. Skip it only when the user explicitly opts out.
1. Resolve the current branch name.
2. Run `rapid td list -s assistant_api`.
3. Compare the listed test drives against the current branch.
4. If a matching test drive already exists for the branch, run `cmdi-test-drive <test-drive-name>`.
5. If no matching test drive exists, run `cmdi-test-drive` with no argument so it creates or resolves one itself.
6. If `cmdi-test-drive` asks follow-up questions, do not wait for the user. Answer them yourself and keep the workflow moving.

When answering `cmdi-test-drive` prompts yourself:
- Do not stop for approval on the generated test plan unless the request is ambiguous or unsafe.
- Treat the skill's questions as internal workflow decisions and complete them autonomously.

### 5) Final status contract

Success:
- `SUCCESS: Implemented | Doc: {doc_path} | Milestones: {summary}`

Blocked:
- `BLOCKED: Milestone: {name_or_none} | Reason: {summary}`

Failed input/parse:
- `FAILED: {reason}`

## Reference Files

- `references/implementation-doc-template.md`
- `references/subagent-prompts.md`
