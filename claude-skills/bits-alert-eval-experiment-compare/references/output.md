# Output Contract

Return only the four sections below plus one short sentence with the main result.

For every row:

```text
absolute change = treatment - baseline
percent change  = (treatment - baseline) / baseline * 100
```

Show a leading `+` or `-` on both changes. For Judge immediate cause, show absolute change in percentage points (`pp`) and calculate percent change from the underlying percentages. When baseline is zero, show percent change as `N/A`.

## Experiments

Show the exact input experiments before metrics:

| Role | Experiment | Run ID | Dataset | Scenario run records | Agent traces resolved |
|---|---|---|---|---:|---:|
| Baseline | [`<base_experiment_id>`](https://app.datadoghq.com/llm/experiments/<base_experiment_id>) | `<exact baseline bits_run_id>` | `<dataset ID>` | | |
| Treatment | [`<treatment_experiment_id>`](https://app.datadoghq.com/llm/experiments/<treatment_experiment_id>) | `<exact treatment bits_run_id>` | `<dataset ID>` | | |

Display every exact unique `bits_run_id` found in that arm's full events. When an arm has more than one, list all values and state the count. Do not shorten, swap, or reconstruct experiment or run IDs from trace metadata.

## Primary comparison

State the total scenario-run-record count for each arm, the matched count with both root traces resolved, and the matched fully measurable RCA-window count used for derived fields. Read these rows directly from the experiment summary: Judge mean score, Judge immediate cause, Mean cost, Mean cached input, Mean non-cached input (`cache_creation_input_tokens`), Mean output, and Mean total duration (`rca_duration_mins`). LLM time, residual tool time, tool-call count, turn count, and all per-turn rows remain trace-derived.

| Metric | Baseline | Treatment | Absolute change | % change |
|---|---:|---:|---:|---:|
| Judge mean score | | | | |
| Judge immediate cause (%) | | | pp | |
| Mean cost ($/scenario run) | | | | |
| Mean input cached tokens (K) | | | | |
| Mean input non-cached tokens (K) | | | | |
| Mean output tokens (K) | | | | |
| Mean total duration (`rca_duration_mins`, min) | | | | |
| Mean LLM request time (min/trace) | | | | |
| Mean tool-call time (min/trace) | | | | |
| Mean tool-call count (calls/trace) | | | | |
| Mean turn count | | | | |

## Per-turn deep dive

State the number of ordinary turn records in each arm, then produce one table:

| Metric per turn | Baseline | Treatment | Absolute change | % change |
|---|---:|---:|---:|---:|
| Mean cached input tokens (K/turn) | | | | |
| Mean non-cached input tokens (K/turn) | | | | |
| Mean LLM request time (s/turn) | | | | |
| Mean tool-call time (s/turn) | | | | |
| Mean tool-call count (calls/turn) | | | | |
| Mean LLM request latency (s/request) | | | | |

When event and agent-loop tool grouping are both unavailable, add:

> ¹Tool-call count was inferred by counting tool spans whose parent is not another tool span.

## Reference

Link both resolved absolute experiment snapshot folders. State that each `results.json` contains that arm's audited aggregates and the common included pairing keys:

```markdown
### Reference

Baseline data: [`<absolute baseline experiment folder>`](<absolute baseline experiment folder>)

Treatment data: [`<absolute treatment experiment folder>`](<absolute treatment experiment folder>)

Each folder contains that experiment's compact scenario records, RCA-bounded trace records, collection audit, and `results.json` used for this report.
```
