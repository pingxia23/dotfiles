---
name: rlm
description: >
  Process tasks that require analyzing inputs far larger than the context window
  (codebases, large log files, document collections, etc.) using Recursive Language
  Model-style decomposition: metadata-only context, iterative code generation, and
  subagents for sub-task execution.
---

# Recursive Language Model (RLM) Skill

Adapted directly from `https://github.com/drewcsillag/rlm-claude`.
Keep the workflow and helper usage close to upstream unless something is clearly
wrong for this environment.

You are operating in RLM mode. This skill lets you handle tasks whose input is too
large to fit in your context window by keeping large data in files and processing it
recursively via subagents.

**Core constraint: you must NEVER read large file contents directly into your context.
Use only metadata (size, line count, previews) and targeted chunks.**

Before using the helper, set:

```bash
RLM_REPL="$HOME/dotfiles/claude-skills/rlm/rlm-repl.py"
```

---

## Phase 1: Input Identification

Parse the user request that triggered this skill. Then determine the relevant input:

1. Use shell commands to discover scope **without reading content**:
   ```bash
   find <target> -type f | head -50
   wc -l <file>
   du -sh <target>
   python3 "$RLM_REPL" metadata <file>
   ```

2. Build a **manifest** — a list of all input files with their metadata. Store it at
   `/tmp/rlm-<session-id>/manifest.json` where `<session-id>` is a short random ID
   (use `python3 -c "import uuid; print(uuid.uuid4().hex[:8])"`).

3. From this point on, the manifest is your working context for the input. Do not
   load raw file content into the main conversation.
4. Print the link to manifest.json so the user can click it, open the file, and inspect its contents.

---

## Phase 2: Depth Estimation & User Confirmation

Estimate how many levels of recursion are needed:

- Each subagent can comfortably handle ~100K tokens (~75K words) of content
- Calculate: `ceil(log2(total_words / 75000))` levels (rough guide)
- Count approximate subagent calls: `ceil(total_words / 75000)` leaf agents

**Then communicate this to the user and wait for their response before proceeding:**

If depth can be estimated (<= 3 levels):
> "This task spans approximately X words across N files. I'll use Y subagent calls
> across Z level(s) of recursion. Proceed?"

If depth would exceed 3 levels or is uncertain:
> "This input is very large (X words). Full processing would need Z levels of
> recursion. I can either:
> 1. Proceed at full depth (Z levels, ~N subagent calls)
> 2. Cap at 3 levels — some content may be summarized more coarsely
>
> Which would you prefer?"
>
> **If the user says no/cap: set `max_depth = 3` and continue — do NOT abort.**
> **If the user says yes/full: proceed at full depth.**

---

## Phase 3: Session Bootstrap

Create the session workspace:

```bash
SESSION_ID=$(python3 -c "import uuid; print(uuid.uuid4().hex[:8])")
mkdir -p /tmp/rlm-${SESSION_ID}/results
echo $SESSION_ID
```

Write the manifest to `/tmp/rlm-${SESSION_ID}/manifest.json`.

The session directory structure:
```
/tmp/rlm-<session-id>/
  manifest.json
  results/
    0001.txt
    0002.txt
    ...
```

---

## Phase 4: Recursive Decomposition

This is the main loop. Partition the work and dispatch subagents.

### Partitioning strategy

Use Python (via shell) to generate a partition plan from the manifest. For a single
large file, split by line ranges. For multiple files, assign files to batches:

```python
import json, math

with open('/tmp/rlm-<SESSION_ID>/manifest.json') as f:
    manifest = json.load(f)

WORDS_PER_CHUNK = 75000
chunks = []
for item in manifest['files']:
    if item['word_count'] <= WORDS_PER_CHUNK:
        chunks.append({'type': 'file', 'path': item['path'],
                       'start': 1, 'end': item['line_count']})
    else:
        lines_per_chunk = max(1, int(item['line_count'] * WORDS_PER_CHUNK / item['word_count']))
        for start in range(1, item['line_count'] + 1, lines_per_chunk):
            end = min(start + lines_per_chunk - 1, item['line_count'])
            chunks.append({'type': 'chunk', 'path': item['path'],
                           'start': start, 'end': end})

print(json.dumps(chunks, indent=2))
```

### Spawning subagents

For each chunk, spawn a subagent. Launch independent chunks in parallel when
possible. Pass the chunk content by extracting it via `rlm-repl.py chunk` — do
not pass the full file.

Each subagent prompt should follow this template:

```
You are processing one partition of a larger RLM task.

## Your task
{sub-task description — same goal as the parent task, scoped to this chunk}

## Your input
The content below is your complete input. Process only this content.

{output of: python3 "$RLM_REPL" chunk <path> <start> <end>}

## Output instructions
Write your result as plain text to: /tmp/rlm-<SESSION_ID>/results/<NNNN>.txt
(use zero-padded chunk number, e.g. 0001.txt)
Do not produce any other output — only write the result file.
```

### Recursion

If a chunk itself exceeds what the subagent can handle (it reports the content is
too large, or `estimated_tokens > 150000`), recursively apply this same partitioning
within the subagent — decrementing the allowed depth by 1.

**Depth limit**: respect the `max_depth` agreed with the user in Phase 2. At depth 0,
the subagent must produce a best-effort result on whatever it can fit in context,
noting any content it could not process.

### Tracking

After all subagents complete, verify that every expected result file exists in
`/tmp/rlm-<SESSION_ID>/results/`. If any are missing, re-run the corresponding
subagent.

---

## Phase 5: Synthesis

Once all result files are present:

```bash
python3 "$RLM_REPL" assemble /tmp/rlm-<SESSION_ID>/results/
```

The assembled content is now small enough to fit in context (it's the compressed
outputs from all subagents, not the raw input). Read it, synthesize a final answer,
and present it to the user.

Clean up the session directory when done:
```bash
rm -rf /tmp/rlm-<SESSION_ID>/
```

---

## Important Rules

1. **Never `cat`, `Read`, or otherwise load large file contents into your context.**
   Use `metadata` for overview, `chunk` for targeted reads.

2. **Subagents get chunks, not file paths** — always extract the chunk content and
   embed it in the subagent prompt. Subagents should not need to run `rlm-repl.py`.

3. **Parallel where possible** — chunks that don't depend on each other should be
   dispatched together when the environment allows parallel subagents.

4. **Depth discipline** — track current depth. Never exceed the user-agreed limit.
   Communicate coarseness if capping prevents full coverage.

5. **The manifest is truth** — all file metadata lives in the manifest. Derive
   partitioning from manifest data, not from re-reading files.
