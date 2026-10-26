# Digest guide

## 1. Group

- Merge an original message and its replies into one topic. A reply also broadcast to the channel stays in its original thread.
- Merge duplicate links, and separate discussions of the same decision, finding, or event, into one topic.
- Keep disagreements and later corrections inside the merged topic. Do not imply consensus.

## 2. Select

Select topics for what the reader can learn or act on:

- architecture decisions and system-design tradeoffs;
- performance findings with measurements and conditions;
- debugging, incidents, migrations, and operational lessons;
- AI/ML techniques, infrastructure, and engineering workflows with real implementation detail;
- explicit asks, blockers, or follow-up work relevant to the reader.

Skip greetings, jokes, ads, bot spam, nontechnical chatter, business news, and announcements with no engineering lesson. Popularity alone never qualifies a topic. A title or URL alone does not support a deep dive.

Choose at most 15 topics, or the requested limit, and never fill a quota.

**Default reader:** a backend engineer with 10+ years of experience who builds agent products, from post-training to launch. Connect topics to model behavior, evals, tool execution, reliability, latency, and cost, but do not force an agent angle where there is none.

**Labels.** Give each topic:
- 1–3 lowercase **tags**. Prefer `agents`, `evals`, `models`, `inference`, `reliability`, `security`, `devex`, `data`, `product`, `infra`.
- One **evidence** label for the strongest support behind the takeaway: `measured` (a real system, with conditions), `benchmark`, `vendor-claim` (an author reporting on its own product), `anecdote`, `opinion`, `proposal` (not built or measured), or `mixed`.

**Not covered.** List each qualifying source you skipped, with a reason of a few words.

## 3. Order

Follow any ordering rule in the request. Otherwise put direct actions and consequential decisions first, then order by technical depth, usefulness, and evidence strength. Engagement only breaks ties.

When ordering by reply count:
- use the largest original-parent count in each merged topic, not a sum;
- link the heading to that parent and attribute its author;
- keep the supplied counts as they are;
- put unknown counts last, and break ties by input order.

## 4. Write

**Style.** Write for an SDE intern with a CS degree and no knowledge of the source's systems or domain.
- Answer first, using short, concrete sentences.
- Explain every acronym, system name, and domain term the first time it appears, right next to it. Example: "Top Dog, an orchestrator agent that can prompt sessions but cannot approve permissions".
- Show cause and effect: what reads, stores, or changes what, and what that causes.
- Keep source claims separate from your own inference, and label the inference.
- Keep real numbers together with their baselines, conditions, and caveats.
- Flag vendor benchmarks, anecdotes, and disputed claims.
- Use short quotes only.

**Parts of a topic:**
- **Title.** The finding or subject, about 12 words or fewer, linked to the primary source. Use the original message text only if the request asks for it.
- **Byline.** Author, source, and engagement, plus any extra lines the request requires.
- **TL;DR.** One sentence of 25 words or fewer that makes sense on its own. It appears on the overview card.
- **Why this matters.** One to three sentences: what it is, and the concrete capability or lesson it gives this reader.
- **Main takeaway.** One or two sentences: the conclusion and its most important qualification.
- **Deep dive.** Numbered `h4` subsections, each teaching one thing, in the primary source's order. Use one to three short paragraphs between visuals. Discussion additions come after the part they comment on. Most deep dives are 300–900 words; never pad thin evidence.

**Visuals.** Every deep dive needs at least one visual when the evidence has a shape. Introduce each visual, and use real numbers only.

| The evidence has… | Use |
|---|---|
| a pipeline or data flow | `flow` |
| an ordered procedure or loop | `steps` |
| a few headline numbers | `stats` |
| 3+ comparable numbers on one scale | `bars` |
| options compared on several attributes | `table` |
| a before/after or today/planned change | `split` |
| several people taking positions | `voices` |
| a step the reader can take | `callout action` |
| an important limit, or a missing source | `callout caveat`, `callout gap` |
| anything else | `pre.diagram` or inline `svg.figure` |

**Final check.** Reread each topic as the intern would. Can they decide from the title, TL;DR, and *Why this matters* whether to open it? Is every term defined at first use? Does every number keep its conditions? Are disagreements and gaps visible? Rewrite whatever fails. Use an action callout, never a "What to do" section.

## Incomplete or empty material

- **Some sources failed.** Cover what is supported, list each failure under coverage, and add a `callout gap` inside the topic it affects.
- **Usable material, but nothing qualifies.** Return the requested empty-result text (default `Nothing interesting in the supplied material.`) plus known gaps, and build no page.
- **No usable material.** Report the collection failure. Never present it as an empty success.
