---
name: student-math-practice
description: "Create or revise student math practice from a target concept, learning goal, and focus or exclusion constraints. Research relevant online math education resources, design varied problems, and provide clear step-by-step solutions with helpful visuals. Use for worksheets, practice sets, puzzles, or answer keys, rather than a single standalone math question."
---

# Student Math Practice

Turn a learning intention into varied practice that teaches and checks the intended concept. Research how that concept is taught, respect the learner's constraints, and make each solution easy to follow. Choose the problem format to serve the concept; do not default to a puzzle or a particular operation.

## 1. Understand the learning intention and constraints

Extract a short working brief from the request and prior context:

- **Concept and goal:** what the learner should understand or be able to do after the practice. Distinguish conceptual understanding, calculation fluency, application, and explanation when relevant.
- **Learner:** grade or approximate level, prior knowledge, and any known difficulties.
- **Focus:** skills, representations, methods, or problem types to emphasize.
- **Exclusions:** topics, methods, number types, contexts, or difficulty features to leave out.
- **Bounds:** permitted number ranges, calculation complexity, amount of reasoning, trial limits if any, and allowed aids.
- **Deliverable:** number of problems or practice duration, language, format, and destination.

Ask only for missing information that materially changes the work. Otherwise make a reasonable assumption, state it briefly, and proceed. Do not require the user to complete a form when the intent is already clear.

Treat focus items and exclusions as constraints on both questions and solutions. A problem fails an exclusion if its solution secretly requires the excluded method or concept. Do not inherit multiplication limits, a grade range, or a three-try rule from an unrelated earlier worksheet.

For edits, inspect the supplied practice first. Preserve its accepted structure and content outside the requested change. Changing arithmetic difficulty does not itself authorize changing the type of problem or the reasoning challenge.

## 2. Research relevant online math education

Search the web for the target concept at the learner's level before designing a new practice set. Use the focus and exclusions to narrow the search. For a narrow edit to an already researched set, reuse its sources unless the concept or teaching method changes. Respect an explicit request not to browse.

- Prefer materials from curriculum publishers, education organizations, universities, and established math teaching projects. Use original teaching resources rather than search summaries or generic worksheet aggregators.
- Read the relevant lessons or activities. Look for prerequisites, useful representations, common misconceptions, age-appropriate methods, and different ways to assess the same concept.
- Use a small set of complementary sources when available. Stop when they support a coherent teaching approach and useful problem variety; avoid collecting links without using them.
- Translate the findings into design choices. For example, if equal-sized wholes are essential to a fraction comparison, make that explicit in the diagrams and include a question that checks it.
- Write original questions informed by the teaching approach. Do not reproduce a publisher's worksheet or answer key wholesale.
- Keep a brief teacher/parent source note with direct links and what each source informed. Place it after the solutions or in accompanying notes so citations do not interrupt the student's work. Distinguish sourced teaching guidance from your own design choices; do not claim curriculum alignment without checking the relevant standard.
- If browsing or a source is unavailable, report the limitation and use accessible material or existing knowledge transparently. Never invent sources or imply research occurred when it did not.

## 3. Design a varied, focused practice set

Choose a small mix of problem types that exercise the learning intention in meaningfully different ways. Suitable options include:

| Purpose | Possible problem type |
| --- | --- |
| Recognize or represent a concept | Identify an example, label a diagram, draw a model, place a value on a number line |
| Use a method | Calculate, complete a missing step, find an unknown, measure |
| Explain a relationship | Compare, sort, justify, connect two representations |
| Apply understanding | Solve a short word problem, interpret a graph or table, choose an appropriate operation |
| Check reasoning | Explain a mistake, test a claim, construct an example or counterexample |

Select types appropriate to the learner and requested set size. These are options, not mandatory sections. Changing only the numbers or story names is not meaningful variety. Do not add unrelated topics just to create variety.

Order the work from an accessible entry point toward less supported applications. Vary one source of difficulty at a time when possible. Avoid surprise prerequisite skills, unnecessary reading load, or tedious arithmetic that obscures the intended concept. Include a harder extension only when it fits the requested bounds.

Before laying out the document, map each problem to its purpose, problem type, and constraints. Use this to catch repeated formats, missing focus areas, and excluded content. Keep this planning detail out of the student's worksheet unless it helps the learner.

## 4. Write easy-to-follow solutions

Read [the solution guide](references/visual-solution-guide.md) when writing the answer key. Its core teaching pattern applies across topics:

1. State the immediate goal and identify the relevant information in the problem.
2. Show one manageable reasoning step and explain why it is valid.
3. Keep the relevant problem, expression, or diagram close to that explanation. Highlight the part currently being used when it helps the learner follow the connection.
4. Carry established results forward without revealing future answers too early. Distinguish a temporary guess from a confirmed result when trial is actually part of the method.
5. Give the answer in context, including units where needed, and check it using a method the learner understands.

Use visuals when they make the reasoning clearer: number lines, fraction strips, place-value models, geometric diagrams, graphs, tables, or highlighted text and expressions. Prefer a few short equations or sentences when a diagram would add clutter. Do not force a visual, trial-and-error search, or fixed step count onto every problem.

For multi-step visual problems, keep a diagram beside each meaningful step and update it gradually. End with the completed representation when it is part of the task. An answer list alone does not replace a worked explanation.

The user-approved [crossword example](references/crossword-example.md) and its bundled PDF show this style in detail. Read them when a grid-based task or visual layout example would help. They illustrate presentation, not defaults for the topic, operations, grade, trial count, or problem structure.

## 5. Produce and check the deliverable

- Default to **one combined PDF** with student practice first, worked solutions next, and a short source note last. Honor another requested format. Create separate practice and answer files only when requested.
- Use clear numbering so every solution matches its question. Provide appropriate working space. Keep a complete reasoning step and its visual together; add pages instead of making the text too small.
- Use labels, words, and outlines as well as color. Diagrams must communicate the math correctly, including equal units, scale, and any necessary “not to scale” note.
- Use document and vector drawing tools for exact math. Discover bundled PDF libraries through `load_workspace_dependencies` when available; do not assume the sample's runtime or font paths exist elsewhere.
- Solve every problem independently. Verify answers, units, assumptions, and any intended uniqueness. For open-ended questions, give an example answer and explain what makes other answers valid.
- Audit the full solution route against the user's focus, exclusions, and difficulty bounds, including any explicit limit on candidate tries. Avoid undocumented restrictions on possible answers.
- Verify that the set has real variety and that each step uses only given information, established results, or a clearly labeled trial. Check that visual highlights and intermediate states match the explanation.
- For a solution-only revision, compare the practice content with the accepted version to ensure it is unchanged.
- Render the PDF and inspect representative pages, including the longest explanation and each visual type. Check that all pages render, text fits, and every question has its solution.
- Save to the requested location. In this user's local desktop workflow, default to an identifiable combined PDF in Downloads and open it in the available viewer. Return one prominent link to the combined file and briefly state the concept covered and any material limitation.
