---
name: video-learning-notes
description: Turn technical or educational videos, YouTube links, recordings, captions, and transcripts into progressive learning notes. Use when the user asks to learn from a video, create lecture or study notes, build a study guide, summarize a tutorial for learning, extract key concepts, create a learning path, or convert a video into a reusable reference.
---

# Video Learning Notes

Create a text-first study guide that helps the reader learn the material without replaying the entire video. Front-load the study path, key concepts, and mental model; place the detailed, source-ordered drill-down afterward.

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

## Study path
<A short pass-by-pass plan: what to read/watch, the goal, and a checkpoint>

## Key concepts
<A compact table: Concept | Meaning | Why it matters>

## Core mental model
<A concise explanation and, when useful, a small ASCII diagram>

## Detailed notes
### <timestamp or range> — <learning unit>
<Takeaway first, then explanation, example, connections, and tradeoffs>

## Practical takeaways
<Decisions, checklist, or application guidance>

## Self-check
<Questions or short exercises that test recall and application>

## Resources
<Creator-linked source files and any clearly labeled supplemental sources>
```

Keep the front section scannable. The study path, key concepts, and mental model should orient the reader; reserve most explanation for the detailed notes.

## Section guidance

### Study path

Create two to five passes based on the material, not arbitrary time slices. For each pass, include:

- the relevant timestamp range or note sections,
- the learning goal,
- a concrete checkpoint such as “explain X without notes” or “implement Y.”

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

### Practical takeaways and self-check

Translate the lecture into actions appropriate to the subject: an implementation checklist for engineering, practice sequence for a course, or decision rules for a conceptual talk.

Write self-check questions that test explanation, comparison, application, and failure analysis—not trivia. Include answers only when requested or when a compact answer key improves the guide.

## Evidence and attribution

- Make the video the primary source and link it at the top.
- Link important sections to exact timestamps when possible.
- Include creator-provided notebooks, repositories, slides, papers, or exercises in Resources.
- Label outside research as supplemental; do not blend it into the speaker's claims.
- Paraphrase copyrighted material. Do not reconstruct a near-verbatim transcript.
- Attribute opinions and uncertain claims to the speaker instead of presenting them as settled fact.

## Deliverable

Create one Markdown file unless the user asks for inline notes or another format. In a projectless Codex task, save the final guide under `outputs/`. Use a descriptive name such as `<topic>-learning-notes.md`.

Keep raw captions, downloaded media, and intermediate files outside the deliverable directory. Do not create a snapshots folder unless explicitly requested.

## Quality check

Before finishing, verify that:

- the study path and key concepts appear before the detailed notes,
- a new reader can identify what the video teaches and why it matters from the front section,
- the detailed sections follow a clear dependency order,
- timestamps and links resolve to the claimed material,
- technical names and numerical claims were checked,
- examples show input, intermediate reasoning, and output where applicable,
- important caveats and tradeoffs remain intact,
- no snapshots or unnecessary media were created,
- the final guide is a synthesis rather than a transcript rewrite.
