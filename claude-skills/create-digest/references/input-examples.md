# Input examples

## Direct use with pasted notes

```text
Use $create-digest on these notes. Pick the most useful engineering lessons.

[Paste raw notes, messages, articles, or excerpts here.]
```

No source links, dates, reply counts, or collection status are required. Use any that are supplied; do not invent the rest.

## Direct use with files

```text
Use $create-digest on /absolute/path/to/material.md.
Prioritize system design and performance. Include at most five topics.
Return the digest here.
```

## Optional structured input

No wrapper or fixed format is required. Automated callers can use an object such as:

```json
{
  "material": "Article text, notes, or substantive excerpts."
}
```

`material` can also be an array or object containing structured source records. Keep source URLs, authors, dates, ordered replies, and original-versus-secondhand evidence with their respective records.

Optional fields are preserved without filling in unknown facts:

```json
{
  "material": [{ "title": "Example", "text": "Substantive source content" }],
  "scope": "Supplied newsletter issue and date",
  "coverage": { "gaps": ["Discussion could not be read"] },
  "preferences": {
    "max_items": 5,
    "empty_result_text": "Nothing interesting this week.",
    "audience": "Backend engineer building agent products",
    "ordering": "technical usefulness",
    "output": "rendered Markdown here"
  }
}
```

Field names are illustrative. Missing preferences use the skill's defaults. The assistant evaluates the supplied evidence and reports known gaps; an unreported collection failure cannot be detected from the input alone.
