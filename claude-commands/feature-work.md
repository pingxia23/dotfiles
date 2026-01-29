# Feature Implementation Workflow

**Task:** $ARGUMENTS

---

## Setup

1. Derive a kebab-case slug from the task description (e.g., "rename an SD" → `rename-sd`)
2. Create directory: `plans/{slug}/`
3. **Save the original prompt** to `plans/{slug}/PROMPT.md` (the exact $ARGUMENTS text)
---

## Phase 1: Analysis & Questions

Your task is NOT to implement yet, but to fully understand and prepare.

**Responsibilities:**

- Analyze and understand the existing codebase thoroughly - use Read, Glob, Grep tools extensively
- Determine exactly how this feature integrates, including dependencies, structure, edge cases (within reason, don't go overboard), and constraints
- Clearly identify anything unclear or ambiguous in the description or current implementation
- Ask SPECIFIC, DETAILED questions - not vague yes/no questions
- Cover: Architecture decisions, API design, data models, error handling, testing approach, edge cases, integration points
- Write all questions or ambiguities to `plans/{slug}/QUESTIONS-1.md`

**Quality of questions matters:**

- Ask about specific technical decisions (e.g., "Should the endpoint return just {id} or include {id, name, status}?")
- Ask about error cases (e.g., "What should happen when X fails?")
- Ask about constraints (e.g., "What's the expected scale/volume?")
- Ask about integration (e.g., "Should this use the existing AuthService or create new?")
- Be thorough - 5-10 well-thought-out questions is better than 2-3 vague ones

**Important:**

- Do NOT assume any requirements or scope beyond explicitly described details
- Do NOT implement anything yet - just explore, plan, and ask questions
- This phase is iterative: after user answers QUESTIONS-1.md, you may write QUESTIONS-2.md, etc.
- Continue until all ambiguities are resolved

**ITERATIVE Q&A:**

- ASK AS MANY ROUNDS OF QUESTIONS AS YOU NEED - Don't rush to planning!
- QUESTIONS-1, wait for answers, then QUESTIONS-2, wait for answers, then QUESTIONS-3, etc.
- After each round of answers, if ANYTHING is still unclear or ambiguous, ASK MORE QUESTIONS
- Only when you are 100% confident you understand everything should you move to planning
- It's BETTER to ask too many questions than to make assumptions

**When the user says "I've answered your questions. Please continue.":**

- Review what you know from ALL answered questions
- If ANYTHING is still unclear, ambiguous, or needs clarification → ASK MORE QUESTIONS (QUESTIONS-{N+1})
- Only when you are 100% confident you understand EVERYTHING should you create a plan
- If in doubt, ASK - don't assume

**DO NOT create a plan until:**

1. You have asked all necessary questions
2. You have received and reviewed all answers
3. You have NO remaining ambiguities or assumptions
4. You are completely confident in your understanding

**Questions File Template:**

When creating QUESTIONS-*.md files, use this format:

```markdown
<!-- INSTRUCTIONS FOR ANSWERING QUESTIONS -->
<!--
- Answer each question inline below the question
- You can edit the questions if they're unclear
- Add your answers under each question
- When done, save the file and let me know
-->

## Q1: Your first question here

## Q2: Your second question here

---

## Anything else you'd like to mention?

**Additional context or clarifications:**


<!-- Save this file when you're done -->
```

**⏸ CHECKPOINT**: When you have no more questions, say "No more questions. Say 'continue' for Phase 2"

---

## Phase 2: Plan Creation

Based on the full exchange, produce a markdown plan document (`plans/{slug}/PLAN.md`).

**Requirements for the plan:**

- Include clear, minimal, concise steps
- Track the status of each step using these emojis:
  - 🟩 Done
  - 🟨 In Progress
  - 🟥 To Do
- Include dynamic tracking of overall progress percentage (at top)
- Do NOT add extra scope or unnecessary complexity beyond explicitly clarified details
- Steps should be modular, elegant, minimal, and integrate seamlessly within the existing codebase
- Use TDD: tests MUST be written BEFORE implementation code (strict TDD)
- Every task should have corresponding test tasks
- Test commands should be listed for each task
- If you make subsidiary plan files, todos files, memory files, etc., link them from PLAN.md
- As subsidiary plans change through implementation, update the top level plan as well

**CRITICAL FORMAT REQUIREMENTS:**

- First line MUST be: **Overall Progress:** `0%`
- Use checkbox format: `- [ ]` (space between brackets)
- EVERY task MUST have an emoji: 🟥 (To Do), 🟨 (In Progress), or 🟩 (Done)
- Start all tasks as 🟥 (To Do)
- Use **bold** for task names
- Nest sub-tasks with indentation
- Group into phases if complex
- Tests BEFORE implementation (TDD)

** Plan Maintenance **
- *Every step* must end with a subitem to update plan documents
- Plan documents include:
  - `PLAN.md` the top-level plan with overall progress
  - `PLAN-PHASE-{N}.md` - detailed phase plans (when overall plan is big enough)
- the update subitem should reflect progress percentage, step statuses, and any deviations from the original plan
- If phase plans exist, update both the phase plan and the top-level PLAN.md

**Template Example:**

```markdown
# Feature Implementation Plan

**Overall Progress:** `0%`

## Phase 1: Authentication Module

- [ ] 🟥 **Task 1.1: Setup authentication service**
  - [ ] 🟥 Write test: Test authentication service initialization
  - [ ] 🟥 Implement: Create authentication service class
  - [ ] 🟥 Test: Run `npm test auth.service.test.js`
  - [ ] 🟥 Update PLAN.md (and PLAN-PHASE-1.md if exists)

- [ ] 🟥 **Task 1.2: JWT token handling**
  - [ ] 🟥 Write test: Test JWT generation and validation
  - [ ] 🟥 Implement: Add JWT token handling methods
  - [ ] 🟥 Test: Run `npm test jwt.test.js`
  - [ ] 🟥 Update PLAN.md (and PLAN-PHASE-1.md if exists)

## Phase 2: Frontend Login UI

- [ ] 🟥 **Task 2.1: Login page component**
  - [ ] 🟥 Write test: Test component rendering and interaction
  - [ ] 🟥 Implement: Design login page component
  - [ ] 🟥 Test: Run `npm test LoginPage.test.jsx`
  - [ ] 🟥 Update PLAN.md (and PLAN-PHASE-2.md if exists)

```

**⏸ CHECKPOINT**: When PLAN.md is ready, say "Plan created. Say 'continue' for Phase 3"

---

## Phase 3: Plan Critique

Review the plan in PLAN.md as a staff engineer using this comprehensive checklist.

**IMPORTANT:** Ensure the plan follows TDD (Test-Driven Development):
- Tests should be written BEFORE implementation code
- Every task should have corresponding test tasks
- Test commands should be listed

### Review Checklist

#### 1. Task Sequencing & Visibility (Including TDD)
- Tests written FIRST, then implementation (strict TDD)
- Early tasks show visible progress without extra work
- Tasks that don't belong are identified for removal
- Missing tasks are identified and added
- Each implementation task has corresponding test task(s)

#### 2. Dependencies & Task Ordering
- Prerequisites completed before dependent tasks
- Independent tasks identified for parallel execution
- Read/understand steps precede modification steps

#### 3. Risk Management & Validation
- High-risk/uncertain tasks scheduled early (fail-fast principle)
- Verification/validation step exists for each major change
- Rollback strategy defined if changes break functionality

#### 4. Scope Control
- Task granularity appropriate (neither too fine nor too coarse)
- Scope creep and tangential work avoided
- Clear stopping point defined (not open-ended)

#### 5. Technical Readiness
- Required files, dependencies, and permissions identified
- Breaking changes identified and mitigation planned
- Backwards compatibility addressed if needed

#### 6. Efficiency & Reuse
- Existing solutions checked before building new ones
- Existing patterns/code identified for reuse
- Unnecessary exploration avoided when path is known

#### 7. Communication & Checkpoints
- Natural checkpoints exist to show user progress
- User input/decisions required identified upfront
- Output/deliverable clearly defined

**Additional requirements:**

- PLAN sections should link to QUESTIONS or other .md files where relevant
- This phase may generate questions - write them to `plans/{slug}/QUESTIONS-PLAN-1.md` (and iterate as needed)
- After review, if you identify any ambiguities or missing information, ask questions in QUESTIONS-PLAN-*.md files

**⏸ CHECKPOINT**: When plan is finalized, say "Plan finalized. Say 'continue' for Phase 4"

---

## Phase 4: Implementation

Now implement precisely as planned, in full.

**Implementation Requirements:**

- Write elegant, minimal, modular code
- Adhere strictly to existing code patterns, conventions, and best practices
- Include clear comments/documentation within the code where needed
- As you implement each step:
  - Update PLAN.md with emoji status and overall progress percentage
- Follow TDD: write failing tests first, then implement to make them pass
- Update PLAN.md if implementation reality differs from the original plan

---

## Phase 5: Code Review (Subagent)

Launch a fresh subagent to review the implementation against the plan.

**Use the Task tool with these parameters:**

```
Task tool call:
  subagent_type: "general-purpose"
  description: "Review implementation against plan"
  prompt: |
    You are a code reviewer. Your task is to review a feature implementation.

    1. Read the plan file at: plans/{slug}/PLAN.md
    2. Read the original prompt at: plans/{slug}/PROMPT.md
    3. Use git diff to see all changes made
    4. Review the implementation against the plan:
       - Are all planned tasks completed?
       - Does the implementation match what was planned?
       - Are there any deviations from the plan?
       - Is the code quality acceptable?
       - Are tests present and adequate?
    5. Write your review to: plans/{slug}/REVIEW.md

    Include in your review:
    - Summary of changes
    - Checklist of plan items vs implementation
    - Any concerns or issues found
    - Recommendations (if any)
```

**Why a fresh subagent?**
- Fresh context means unbiased review (no prior conversation influence)
- Can catch things the implementer missed due to tunnel vision
- Simulates a real code review from another engineer

**⏸ CHECKPOINT**: After review is complete, read REVIEW.md and address any issues before committing.

---

## Phase 6: Committing Changes

When ready to commit:
1. Execute the `/commit-smart` command to handle the commit workflow
2. This will automatically:
   - Stage and analyze changes
   - Generate appropriate commit message
   - Handle any pre-commit hook failures
   - Push to GitHub
   - Create or update the PR
