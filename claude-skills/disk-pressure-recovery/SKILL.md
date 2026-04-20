---
name: disk-pressure-recovery
description: "Recover from disk pressure in dd-scope by running the stale Bazel cleanup script, then using a fresh sub-agent to inspect `bzl run //:dd-doctor` output and prune the specific stale output bases or stale artifacts it identifies."
---

# Disk Pressure Recovery

Use this skill only for disk-pressure recovery in dd-scope.

## Workflow

1. Resolve git context and normalize the repo root.
   - Run:
     - `eval "$("$HOME/dotfiles/scripts/git-context.sh")"`
   - The helper must provide: `inside_worktree`, `worktree_root`, `worktree_path`, `branch`, `repo`, `in_dd_scope`.
   - If helper exits non-zero, stop and return:
     - `BLOCKED: git context resolution failed | Reason: {summary}`
   - `cd "$worktree_root"` before running any command.
   - If `in_dd_scope != true`, stop and return:
     - `BLOCKED: outside dd-scope | Reason: disk-pressure recovery is only supported under ~/dd`

2. Always run the stale Bazel cleanup helper first.
   - Run:
     - `CURRENT_WORKSPACE_ROOT="$worktree_root" "$HOME/dotfiles/scripts/cleanup-stale-bazel-output-bases.sh"`
   - If the cleanup helper fails, capture the failure summary and continue to Step 3 anyway.

3. Always launch a fresh remediation sub-agent after the cleanup helper.
   - Never use mini models for this sub-agent.
   - The sub-agent must:
     - `cd "$worktree_root"` before running any command
     - run `bzl run //:dd-doctor`
     - read the dd-doctor output
     - identify the specific stale output bases or stale artifacts worth pruning
     - prune only the specific stale targets justified by dd-doctor
     - never run `bzl clean`
   - If `bzl run //:dd-doctor` itself fails, return:
     - `BLOCKED: dd-doctor failed | Reason: {summary}; Cleanup helper: {summary_or_none}`
   - If dd-doctor identifies actionable targets and the sub-agent prunes them, return:
     - `RETRY: disk-pressure remediation complete | Actions: {summary} | Evidence: {summary} | Cleanup helper: {summary_or_none}`
   - If dd-doctor identifies actionable targets but the sub-agent cannot safely prune them or the prune attempt fails, return:
     - `BLOCKED: targeted remediation failed | Reason: {summary}; Cleanup helper: {summary_or_none}`
   - If dd-doctor does not identify additional actionable targets after the cleanup helper, still return:
     - `RETRY: disk-pressure remediation complete | Actions: cleanup helper only | Evidence: dd-doctor found no additional actionable targets | Cleanup helper: {summary_or_none}`

## Output Contract

Return one of these exact shapes with no markdown fences:

- `RETRY: disk-pressure remediation complete | Actions: {summary} | Evidence: {summary}`
- `BLOCKED: git context resolution failed | Reason: {summary}`
- `BLOCKED: outside dd-scope | Reason: {summary}`
- `BLOCKED: dd-doctor failed | Reason: {summary}`
- `BLOCKED: targeted remediation failed | Reason: {summary}`
