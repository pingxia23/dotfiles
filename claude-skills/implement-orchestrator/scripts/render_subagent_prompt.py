#!/usr/bin/env python3

from __future__ import annotations

import argparse
import sys


CODE_IMPLEMENT_LOOP_INPUT_TEMPLATE = """Implement milestone `{milestone_name}` from `{implementation_doc_path}`.
Use the milestone block below as the sole implementation source.
Implement only this milestone and do not work on other milestones.
{milestone_block}

Rules:
- Treat the structured inputs above as canonical. Do not re-derive or rewrite them.
- Respect repository guardrails (no branch rename, no destructive git cleanup).
- If using GitHub commands inside a git worktree, resolve `owner/repo` from this worktree and pass `--repo <owner/repo>` to `gh` commands.
- Run verification commands exactly as written in the milestone.
- Complete this milestone as one commit via `code-implement-loop`; do not include changes from other milestones.
- Stop and return BLOCKED if verification cannot pass.
"""

SUBAGENT_PROMPT_TEMPLATE = """You are a fresh implementation agent.

Use `code-implement-loop` with the following implementation input
{implementation_input}


Return format:
- Return the final output from `code-implement-loop` verbatim.
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--implementation-doc-path", required=True)
    parser.add_argument("--milestone-name", required=True)
    parser.add_argument("--milestone-block", required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    implementation_input = CODE_IMPLEMENT_LOOP_INPUT_TEMPLATE.format(
        implementation_doc_path=args.implementation_doc_path,
        milestone_name=args.milestone_name,
        milestone_block=args.milestone_block,
    )
    sys.stdout.write(SUBAGENT_PROMPT_TEMPLATE.format(implementation_input=implementation_input))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
