---
name: student-math-practice
description: "Create or revise student math practice from a target concept, learning goal, and focus or exclusion constraints. Research relevant teaching resources, start with one or two worked examples, then provide a few practice problems with ample reasoning space and no answer key. Use for worksheets, practice sets, or puzzles, rather than a single standalone math question."
---

# Student Math Practice

Turn a learning intention into practice that first teaches the method, then lets the student use it. Start with **one or two teaching examples with step-by-step solutions**, followed by **a few practice problems without solutions or an answer key**. Use different numbers or content in the examples so they do not reveal the practice answers. Leave ample space after every practice problem for written reasoning and calculations. Research how the concept is taught and respect the learner's constraints. Choose the problem format to serve the concept; do not default to a puzzle or a particular operation.

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
- Write original questions informed by the teaching approach. Do not reproduce a publisher's worksheet wholesale.
- Keep a brief teacher/parent source note with direct links and what each source informed. Place it after the practice (or after solutions when requested) or in accompanying notes so citations do not interrupt the student's work. Distinguish sourced teaching guidance from your own design choices; do not claim curriculum alignment without checking the relevant standard.
- If browsing or a source is unavailable, report the limitation and use accessible material or existing knowledge transparently. Never invent sources or imply research occurred when it did not.

## 3. Design a varied, focused practice set

Choose one or two representative teaching examples, then a small set of practice problems that use the demonstrated methods. Honor the user's requested problem count; teaching examples do not count as practice problems. Keep the scope small enough for the examples to teach the methods the student will need.

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

## 4. Teach with one or two worked examples

Always include the teaching examples and their worked solutions before the practice problems. A request for no answer key or no practice solutions does not remove these teaching examples. Read [the solution guide](references/visual-solution-guide.md) when writing them. Solve practice problems privately to check correctness, but do not publish their answers unless explicitly requested. The teaching pattern applies across topics:

1. State the immediate goal and identify the relevant information in the problem.
2. Show one manageable reasoning step and explain why it is valid.
3. Keep the relevant problem, expression, or diagram close to that explanation. Highlight the part currently being used when it helps the learner follow the connection.
4. Carry established results forward without revealing future answers too early. Distinguish a temporary guess from a confirmed result when trial is actually part of the method.
5. Give the answer in context, including units where needed, and check it using a method the learner understands.

Use visuals when they make the reasoning clearer: number lines, fraction strips, place-value models, geometric diagrams, graphs, tables, or highlighted text and expressions. Prefer a few short equations or sentences when a diagram would add clutter. Do not force a visual, trial-and-error search, or fixed step count onto every problem.

For equation examples, teach by making the same change on both sides. Write the matching operations on a **separate row beneath the two sides**, draw a line, and put the simplified equation below it. Repeat for each operation. Do not replace this with a missing-part shortcut or put the changes only inside an expanded equation on one row. See the equation example in the solution guide for the layout.

For multi-step visual problems, keep a diagram beside each meaningful step and update it gradually. End with the completed representation when it is part of the task. An answer list alone does not replace a worked explanation.

The user-approved [crossword example](references/crossword-example.md) and its bundled PDF show this style in detail. Read them when a grid-based task or visual layout example would help. They illustrate presentation, not defaults for the topic, operations, grade, trial count, or problem structure.

## 5. Produce and check the deliverable

- Default to **one PDF** in this order: one or two worked teaching examples, a few practice problems, then a short source note. Include no practice solutions or answer key unless explicitly requested; if requested, put them after the practice. Honor another requested format. Create separate practice and answer files only when requested.
- Use a simple title naming the topic, such as **Equations**, without adding labels such as "tricky."
- Use clear problem numbering. Leave a clearly visible blank or ruled writing area immediately after every problem for reasoning steps, calculations, and any required drawings. Size it to the expected work, with more room for multi-step problems; a single final-answer line is not enough. Keep each problem and its working area together. Add pages instead of shrinking writing space or text. In other formats, use spacing that survives rendering rather than repeated blank Markdown lines that may collapse.
- Label teaching examples separately from numbered practice problems. Keep each example's reasoning step and its visual together. When practice solutions are explicitly requested, match their numbering to the practice questions.
- Use labels, words, and outlines as well as color. Diagrams must communicate the math correctly, including equal units, scale, and any necessary “not to scale” note.
- Use document and vector drawing tools for exact math. Discover bundled PDF libraries through `load_workspace_dependencies` when available; do not assume the sample's runtime or font paths exist elsewhere.
- Solve every teaching example and practice problem independently for internal verification. Verify answers, units, assumptions, and any intended uniqueness. For open-ended practice questions, check an example answer and the criteria for other valid answers privately. Only teaching-example solutions belong in the default deliverable.
- Audit the full solution route against the user's focus, exclusions, and difficulty bounds, including any explicit limit on candidate tries. Avoid undocumented restrictions on possible answers.
- Verify that the set has real variety and that each step uses only given information, established results, or a clearly labeled trial. Check that visual highlights and intermediate states match the explanation.
- For a solution-only revision, compare the practice content with the accepted version to ensure it is unchanged.
- Render the PDF and inspect the teaching examples, the problems requiring the most working space, and each visual type. Check that all pages render, text fits, and every practice problem has ample visible space for its reasoning steps. Confirm that one or two worked examples come first and that practice solutions and answer keys are absent unless requested. For equation examples, check that matching operations occupy a separate row beneath both sides. When practice solutions are requested, also check that every question has its solution.
- Save to the requested location. In this user's local desktop workflow, default to an identifiable practice PDF in Downloads and open it in the available viewer. Return one prominent link to the file and briefly state the concept covered and any material limitation.
