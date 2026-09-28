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

Use this template when the material has multiple sources or specific presentation requirements. Only the source content is required; omit fields that do not apply. Field names are illustrative, not a required parser format.

```text
Use $create-digest with this material.

Scope: source name and issue/date or exact time window with timezone
Known gaps or filters:
Audience/interests:
Ordering:
Maximum items:
Empty-result text:
Output: rendered Markdown here, or an explicit local file path

Item:
  Original text:
  Source ID or URL:
  Title and author/submitter, with roles distinguished:
  Publication timestamp:
  Reply count and when measured:
  Replies: ordered text with attribution and links when available
  Linked evidence: document text or excerpts with source URLs
  Secondhand summaries: labeled separately from original content
  Known missing or truncated content:

Repeat Item as needed.
```

For Slack material, an ordering preference can be `original-parent reply count descending`. For newsletter material, it can be `technical usefulness` or `the issue's supplied comment counts descending`. These preferences affect presentation without changing the input contract.
