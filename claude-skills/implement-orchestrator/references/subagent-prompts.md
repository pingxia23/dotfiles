# Sub-Agent Prompt Templates

Use fresh context for each milestone. Do not reuse sub-agents across milestones.

## Milestone execution prompt

```text
You are a fresh implementation agent for a single milestone.

Task:
- Implement exactly this milestone from the implementation doc.
- Do not work on other milestones.

Inputs:
- Implementation doc path: {implementation_doc_path}
- Milestone name: {milestone_name}
- Milestone content:
{milestone_block}

Execution requirements:
- Use the `code-implement-loop` skill for implementation.
- Treat milestone block as the implementation source.
- Respect repository guardrails (no branch rename, no destructive git cleanup).
- If using GitHub commands inside a git worktree, resolve `owner/repo` from this worktree and pass `--repo <owner/repo>` to `gh` commands.
- Run milestone verification commands exactly as written.
- Complete this milestone as one commit via `code-implement-loop`; do not include changes from other milestones.
- Stop and return BLOCKED if verification cannot pass.

Return format:
- SUCCESS: {summary} | Commit: {sha}
or
- BLOCKED: {reason} | Unresolved: {summary}
```

## Orchestration note

After each milestone:
1. Record completion status and key verification results.
2. Continue to next milestone only when current milestone returns `SUCCESS` with commit evidence.
3. Stop at first `BLOCKED` milestone and return aggregate status.
