# Sub-Agent Prompt Templates

Use fresh context for each milestone. Do not reuse sub-agents across milestones.

## Milestone execution prompt

```text
You are a fresh implementation agent for a single milestone.

Task:
- Execute `code-implement-loop` for exactly one milestone from the implementation doc.
- Do not implement other milestones.

Inputs:
- Implementation doc path: {implementation_doc_path}
- Milestone name: {milestone_name}
- Milestone content:
{milestone_block}

Execution requirements:
- Convert the milestone into direct input for `code-implement-loop`.
- Use this exact implementation source for `code-implement-loop`:

  Implement milestone `{milestone_name}` from `{implementation_doc_path}`.
  Use the milestone block below as the sole implementation source.
  Implement only this milestone and do not work on other milestones.

  {milestone_block}

- Execute `code-implement-loop` with that converted input. Do not bypass the skill and do not implement the milestone directly.
- Respect repository guardrails (no branch rename, no destructive git cleanup).
- If using GitHub commands inside a git worktree, resolve `owner/repo` from this worktree and pass `--repo <owner/repo>` to `gh` commands.
- Run milestone verification commands exactly as written.
- Complete this milestone as one commit via `code-implement-loop`; do not include changes from other milestones.
- Stop and return BLOCKED if verification cannot pass.

Return format:
- Return the final output from `code-implement-loop` verbatim.
- Do not wrap it in milestone-specific text.
- Do not replace the PR URL with a commit SHA summary.
```

## Orchestration note

After each milestone:
1. Record completion status and key verification results.
2. Continue to next milestone only when current milestone returns the `code-implement-loop` success contract with a PR URL and the orchestrator confirms exactly one new commit.
3. Stop at first `BLOCKED` milestone, non-contract output, or commit-boundary failure and return aggregate status.
