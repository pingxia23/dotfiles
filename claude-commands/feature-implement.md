# Feature Implementation Workflow

**Design:** $ARGUMENTS

---

## Setup

1. Parse the design path from $ARGUMENTS (e.g., `designs/my-feature/DESIGN.md`)
2. Extract {slug} from the path (the directory name)
3. Read the DESIGN.md file
4. Locate Section 7 (Implementation Roadmap)
5. Extract the list of milestones (Prerequisites + Milestone 1, 2, 3, etc.)

## Rules
- **Never change the current git branch name**

---

## Phase 1: Milestone Implementation

Implement each milestone from Section 7 using dedicated subagents.

**IMPORTANT: Milestones MUST be implemented in SERIAL order.**
- Launch ONE subagent at a time
- WAIT for it to complete before launching the next
- Do NOT launch multiple milestone subagents in parallel

**For each milestone N (sequentially, one at a time), launch a new milestone-implement subagent to implement:**
```
Task tool call:
  subagent_type: "milestone-implement"
  description: "Implement milestone {N}: {milestone name}"
  prompt: |
    Implement milestone {N} of this feature.

    DESIGN_PATH: {DESIGN_PATH}
    MILESTONE_NUM: {N}

    Report the result back (SUCCESS or FAILED with reason).
```

**After each milestone subagent completes:**
- If SUCCESS: Proceed to the NEXT milestone (launch next subagent)
- If FAILED: **STOP IMMEDIATELY** and report failure to user with details

**Do NOT proceed to Phase 2 until ALL milestones report SUCCESS.**

---

## Phase 2: Code Review

After all milestones complete, launch the implementation-review subagent.

```
Task tool call:
  subagent_type: "implementation-review"
  description: "Review implementation against design"
  prompt: |
    Review the feature implementation.

    DESIGN_PATH: {DESIGN_PATH}

    Report: APPROVED or NEEDS_CHANGES with details.
```

**Why a fresh subagent?**
- Fresh context means unbiased review (no prior conversation influence)
- Can catch things the implementer missed due to tunnel vision
- Simulates a real code review from another engineer

---

## Phase 3: Address Review Feedback (subagent)

Read the IMPLEMENTATION-REVIEW.md file.

**If review says "Needs Changes":**

Launch a single subagent to address all feedback:

```
Task tool call:
  subagent_type: "general-purpose"
  description: "Address review feedback"
  prompt: |
    Address all feedback in the implementation review.

    ## Context
    - Review file: {slug directory}/IMPLEMENTATION-REVIEW.md
    - Design file: {DESIGN_PATH}

    ## Instructions
    1. Read: {slug directory}/IMPLEMENTATION-REVIEW.md
    2. Read: {DESIGN_PATH} for context
    3. Read PR diff: `gh pr diff`
    4. Address each issue raised in the review
    5. Follow TDD for any code changes
    6. Commit and push:
       - Stage: `git add -A -- ':!designs/' ':!plans/' ':!research/'`
       - Commit: `git commit -m "fix: address review feedback"`
       - Push: `git push`
       - Update PR: `gh pr edit --body "..."` (note feedback addressed)
    7. Report: "SUCCESS: Review feedback addressed"
```

**If review says "Approved":** Skip to Phase 4.

---

## Phase 4: Complete

Report completion to user:

1. Get PR URL: `gh pr view --json url -q '.url'`
2. Summarize:
   - "Implementation complete"
   - PR URL
   - List of milestones completed
   - Review status

---

## Output Summary

When complete, the `designs/{slug}/` directory should contain:

| File | Purpose |
|------|---------|
| `DESIGN.md` | Design document (serves as reference) |
| `IMPLEMENTATION-REVIEW.md` | Code review feedback |

The implementation is committed and pushed. PR URL is provided.
