---
name: video-learning-notes
description: Turn technical or educational videos, YouTube links, recordings, captions, and transcripts into progressive learning notes. Use when the user asks to learn from a video, create lecture or study notes, build a study guide, summarize a tutorial for learning, extract key concepts, create a learning path, or convert a video into a reusable reference.
---

# Video Learning Notes

Create a text-first guide that lets the reader understand the material without watching the entire video. Begin with key takeaways that form a standalone summary. Then provide the study path, key concepts, mental model, and detailed source-ordered notes.

## Workflow

### 1. Acquire the source accurately

1. Read the video page for the title, creator, duration, description, chapters, and linked resources.
2. Obtain the spoken content in this order:
   - creator-provided captions or transcript,
   - platform-generated captions,
   - a transcript supplied by the user,
   - audio transcription when captions are unavailable.
3. Preserve timestamps when the source provides them. Do not invent timestamps.
4. Treat generated captions as noisy. Check names, code identifiers, numbers, and domain terminology against the video page, visible source material, or linked primary resources.
5. Avoid downloading the full video when metadata and captions are sufficient. Do not retain the video or raw transcript as a user-facing deliverable unless requested.
6. Do not capture or include snapshots by default. Add images only when the user explicitly requests them.

If the source cannot be accessed, ask for a transcript or uploaded media. State any resulting coverage limitation in the notes.

### 2. Build the learning model

Before drafting, identify:

- the central question the video answers,
- the prerequisite knowledge it assumes,
- three to ten concepts the reader must retain,
- the dependency order among those concepts,
- the demonstrations or worked examples that make the ideas concrete,
- the important constraints, tradeoffs, failure modes, and recommendations.

Group neighboring chapters into coherent learning units. Follow the source's conceptual order in the detailed notes, but do not mechanically paraphrase every chapter or reproduce the transcript.

### 3. Write with progressive depth

Use this order unless the user specifies another structure:

```markdown
# Learning notes: <video title>

Source: <linked title, creator, duration, publication date when known>

## Key takeaways
<State the central thesis in a short paragraph. Follow with concise, logically ordered key-idea bullets. End with a broader takeaway that connects the ideas. Make this section sufficient for a reader who skips the video and the remaining notes.>

## Study path
### Step <number> — <learning goal>
Material: <timestamp range or note sections>

You will learn:

- <important idea, relationship, or tradeoff>
- <important idea, relationship, or tradeoff>

## Key concepts
<A compact table: Concept | Meaning | Why it matters>

## Core mental model
<A concise explanation and, when useful, a small ASCII diagram>

## Detailed notes
### <timestamp or range> — <learning unit>
<Takeaway first, then explanation, example, connections, and tradeoffs>
```

Keep the front section scannable. The key takeaways must work as a complete text alternative. The study path, key concepts, and mental model should then orient readers who want to study the material in more depth; reserve most explanation for the detailed notes.

## Section guidance

### Key takeaways

Write this section as a complete text alternative, not a teaser or table of contents.

- State the central thesis first.
- Use short bold labels for the key-idea bullets.
- Explain what each idea means and why it matters in one to three sentences.
- Order ideas by their logical relationship: thesis, mechanisms, applications, constraints, and implications. Do not mechanically mirror every chapter.
- Define unfamiliar terminology inline.
- Preserve important qualifications, disagreements, and uncertainty. Attribute forecasts and opinions to the speaker.
- End with a paragraph beginning “The broader takeaway:” that connects the ideas into one conclusion.
- Do not require the reader to consult the detailed notes to understand the main argument.

For a long interview, roughly eight to fifteen bullets is usually enough. Use fewer for simpler material.

### Study path

Create two to five steps based on the material, not arbitrary time slices. For each step, include:

- a short heading that states the learning goal,
- the relevant timestamp range or note sections,
- a `You will learn:` list with the important ideas, relationships, and tradeoffs covered in that step.

Use bullet lists instead of a table. Keep each bullet focused on one learning outcome. Do not include checkpoints, exercises, or tests in the study path.

Place this section before all detailed notes.

### Key concepts

List only concepts needed to understand the whole video. Define unfamiliar terms in plain language and state why each concept matters. Prefer a table when it makes the relationships easier to scan.

### Core mental model

Give the reader one organizing model for the subject. Use a small flow, hierarchy, or sequence diagram when three or more components interact. Do not add a diagram when a sentence is clearer.

### Detailed notes

Organize by learning units rather than transcript fragments. For each unit:

1. Lead with the conclusion or takeaway.
2. Explain what is happening and why.
3. Preserve the speaker's important reasoning, constraints, and uncertainty.
4. Include a worked example, pseudocode, comparison table, or branch sketch when it materially improves understanding.
5. Link the heading or first sentence to the exact video timestamp when available.
6. Connect the unit to concepts introduced earlier.

Use the user's language unless requested otherwise. Preserve code, identifiers, formulas, and established technical terminology exactly.

## Evidence and attribution

- Make the video the primary source and link it at the top.
- Link important sections to exact timestamps when possible.
- Link creator-provided notebooks, repositories, slides, papers, or exercises where they support a note.
- Label outside research as supplemental; do not blend it into the speaker's claims.
- Paraphrase copyrighted material. Do not reconstruct a near-verbatim transcript.
- Attribute opinions and uncertain claims to the speaker instead of presenting them as settled fact.

## Deliverable

Create one Markdown file unless the user asks for inline notes or another format. In a projectless Codex task, save the final guide under `outputs/`. Use a descriptive name such as `<topic>-learning-notes.md`.

Keep raw captions, downloaded media, and intermediate files outside the deliverable directory. Do not create a snapshots folder unless explicitly requested.

## Quality check

Before finishing, verify that:

- the key takeaways appear immediately after the source and work as a standalone summary,
- it states the central thesis and ends with a broader takeaway,
- it is sufficient for a reader who does not watch the video or read the remaining notes,
- its bullets explain why each idea matters rather than only naming topics,
- forecasts and opinions remain clearly attributed to the speaker,
- the study path and key concepts appear before the detailed notes,
- each study-path step uses a short `You will learn:` bullet list rather than a dense table,
- a new reader can identify what the video teaches and why it matters from the front section,
- the detailed sections follow a clear dependency order,
- timestamps and links resolve to the claimed material,
- technical names and numerical claims were checked,
- examples show input, intermediate reasoning, and output where applicable,
- important caveats and tradeoffs remain intact,
- no snapshots or unnecessary media were created,
- the final guide is a synthesis rather than a transcript rewrite.
