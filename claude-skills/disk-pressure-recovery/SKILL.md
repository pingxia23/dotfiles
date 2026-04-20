---
name: disk-pressure-recovery
description: "Recover from disk pressure in dd-scope. First run the stale Bazel cleanup helper, then use a fresh sub-agent to inspect `bzl run //:dd-doctor` output and prune only the specific stale output bases or stale artifacts that `dd-doctor` identifies."
---

# Disk Pressure Recovery

Use this skill only to recover disk space in dd-scope.

## Workflow

1. Resolve the repo root and confirm the checkout is under `~/dd`.
   - Run:
     - `eval "$("$HOME/dotfiles/scripts/git-context.sh")"`
   - Use only `worktree_root` and `in_dd_scope` from the helper output.
   - If the helper exits non-zero, stop and return:
     - `BLOCKED: git context resolution failed | Reason: {summary}`
   - If `in_dd_scope != true`, stop and return:
     - `BLOCKED: outside dd-scope | Reason: disk-pressure recovery is only supported under ~/dd`
   - `cd "$worktree_root"` before running `bzl` commands so they execute from a stable workspace root.

2. Always run the stale Bazel cleanup helper before anything else.
   - Run:
     - `"$HOME/dotfiles/scripts/cleanup-stale-bazel-output-bases.sh"`
   - If the cleanup helper fails, record the failure summary and continue to Step 3 anyway.

3. Run `bzl run //:dd-doctor`, inspect its output, and identify the specific stale output bases or stale artifacts it says are safe and worthwhile to remove.
   - Prune only the specific targets justified by `dd-doctor`. Do not do broader cleanup.
   - If anything in this step fails, return:
     - `BLOCKED: dd-doctor failed | Reason: {summary}; Cleanup helper: {summary_or_none}`
   - If dd-doctor identifies actionable targets that have been successfully pruned, return:
     - `RETRY: disk-pressure remediation complete | Actions: {summary} | Evidence: {summary} | Cleanup helper: {summary_or_none}`
   - If dd-doctor identifies actionable targets but they cannot be pruned safely, or the prune attempt fails, return:
     - `BLOCKED: targeted remediation failed | Reason: {summary}; Cleanup helper: {summary_or_none}`
   - If dd-doctor does not identify additional actionable targets after the cleanup helper, still return:
     - `RETRY: disk-pressure remediation complete | Actions: cleanup helper only | Evidence: dd-doctor found no additional actionable targets | Cleanup helper: {summary_or_none}`

## Output Contract

Return exactly one of these shapes, with no markdown fences:

- `RETRY: disk-pressure remediation complete | Actions: {summary} | Evidence: {summary}`
- `BLOCKED: git context resolution failed | Reason: {summary}`
- `BLOCKED: outside dd-scope | Reason: {summary}`
- `BLOCKED: dd-doctor failed | Reason: {summary}`
- `BLOCKED: targeted remediation failed | Reason: {summary}`
