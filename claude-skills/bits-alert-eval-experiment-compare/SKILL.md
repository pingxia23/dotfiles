---
name: bits-alert-eval-experiment-compare
description: Compare treatment and baseline experiments from a Datadog comparison URL for the bits-alert-eval-sdk project across judge quality, experiment cost, RCA duration, tokens, tools, and turns.
---

# Bits Alert Eval Experiment Compare

Use the bundled Python script only to download raw data through the read-only `pup` CLI. Perform all validation, matching, aggregation, auditing, and report writing yourself from the downloaded files.

## Resolve the input

Accept one Datadog experiment comparison URL:

```text
treatment_experiment_id = UUID in /llm/experiments/<UUID>
base_experiment_id      = UUID in compareTargetExperimentId
```

Copy both IDs unchanged. Query parameter order does not change their roles. Refer to them only by these variable names.

## Download the raw records

From this skill directory, run:

```bash
python3 scripts/compare_experiments.py '<comparison URL>'
```

The script downloads, but does not analyze:

| File | Raw contents |
|---|---|
| `summary.json` | Experiment summary returned by `pup` |
| `events.jsonl` | One complete experiment event per line |
| `traces.jsonl` | One agent trace tree plus raw root-agent and LLM span-detail responses per event |
| `turns.jsonl` | One selected raw agent-loop response per event, plus attempted candidates |
| `manifest.json` | Experiment ID, role, paths, and downloaded record counts |

Each event, trace, and turn record shares the same `event_id`. The script keeps per-event checkpoints so an interrupted run can resume.

If the command is interrupted, rerun it with the snapshot ID printed by the first run:

```bash
python3 scripts/compare_experiments.py '<comparison URL>' --snapshot-id '<snapshot ID>'
```

If the command fails after its built-in retries, report the exact error. Do not replace the downloader with Datadog MCP calls.

## Validate the downloaded data

Before calculating metrics:

1. Confirm that each manifest's experiment ID and role match `base_experiment_id` and `treatment_experiment_id`.
2. Confirm that every event has `dimensions.project_name == "bits-alert-eval-sdk"` and both arms have the same non-empty `project_id`.
3. Confirm that both summaries use the same non-empty dataset ID.
4. Confirm that each `events.jsonl` ID is unique and its count matches the manifest.
5. Confirm that the required summary metrics exist: `deepjudge_score`, `deepjudge_immediate_cause_found`, `total_cost_cents`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `output_tokens`, and `rca_duration_mins`.
6. Confirm that the two arms share at least one pairing key.

Stop with the observed and required values if one of these checks fails.

## Match scenario runs

Create the pairing key for each complete event:

```text
dataset_record_canonical_id + "::" + run_iteration
```

Use `scenario_uuid + "::" + run_iteration` only when the canonical ID is absent. Match baseline and treatment events with the same key.

Keep the full event population for experiment-summary metrics. Use matched pairs only for trace-derived and per-turn comparisons.

## Read experiment-summary metrics

Read these values directly from each `summary.json`. Do not derive them from traces, turns, or `current_turn` tags.

| Report row | Summary value |
|---|---|
| Judge mean score | `evals.score.deepjudge_score.mean` |
| Judge immediate cause | percentage of `true` in `evals.categorical.deepjudge_immediate_cause_found.top_values` |
| Mean cost | `evals.score.total_cost_cents.mean / 100` |
| Mean cached input | `evals.score.cache_read_input_tokens.mean / 1,000` |
| Mean non-cached input | `evals.score.cache_creation_input_tokens.mean / 1,000` |
| Mean output | `evals.score.output_tokens.mean / 1,000` |
| Mean total duration | `evals.score.rca_duration_mins.mean` |

`rca_duration_mins` is authoritative for RCA duration. Missing turn data must never suppress this row or any other experiment-summary row.

## Select measurable matched traces

For each matched pair, join `events.jsonl`, `traces.jsonl`, and `turns.jsonl` by `event_id`.

A pair is fully measurable when both arms have:

- a non-null event `metrics.rca_duration_mins`;
- a trace record with `state == "downloaded"`;
- a turn record with `state == "downloaded"` and non-empty `agent_loop.iterations`.

State the number of matched pairs, matched pairs with both traces downloaded, and fully measurable pairs. If no pair is fully measurable, report trace-derived and per-turn rows as `N/A`; still report every experiment-summary row.

## Calculate trace-derived metrics

For each fully measurable event:

1. Walk `trace.root_span` recursively.
2. Select an LLM node only when `kind == "llm"` and its parent is not another LLM node. This prevents counting wrapper children twice.
3. Join those span IDs to the raw spans in `llm_span_detail_batches[].spans`.
4. Set `rca_start` from `root_span_details.spans[0].start_ms` and `rca_end = rca_start + event.metrics.rca_duration_mins * 60,000`. Include an outer LLM only when its full `[start_ms, start_ms + duration_ms]` interval is inside this window. Ignore spans that start after the window. Exclude the matched pair if an outer LLM crosses a boundary or a required span detail is absent.
5. Calculate:

```text
total_duration_ms = event.metrics.rca_duration_mins * 60,000
llm_time_ms       = sum(duration_ms of included outer LLM span details)
tool_time_ms      = total_duration_ms - llm_time_ms
tool_calls        = sum(count(iteration.tool_calls) for agent_loop.iterations)
turns             = count(unique iteration numbers in agent_loop.iterations)
```

`tool_time_ms` is residual time. It includes tool execution, orchestration, serialization, retries, retrieval, and gaps.

Calculate each arm's mean from the same fully measurable matched pairs. Never substitute the root trace duration for `rca_duration_mins`.

## Calculate per-turn metrics

The downloader selects an agent loop by trying trace agent spans with direct LLM children, starting with the span that has the most such children. Audit the selected `agent_span_id` against the trace tree. Reject finalization-only loops.

Group `agent_loop.iterations` by their explicit `iteration` value. Do not use `current_turn`, and do not equate raw LLM request count with turn count.

For each ordinary turn:

```text
cached input       = sum(cache_read_input_tokens)
non-cached input   = sum(non_cached_input_tokens)
LLM request time   = sum(duration_ms)
tool-call count    = sum(count(tool_calls))
```

For tool-call time, join each iteration's `llm_span_id` to `llm_span_detail_batches[].spans` and use the outer LLM start time:

```text
turn 1 starts at root_span_details.spans[0].start_ms
turn N starts at the earliest outer LLM start_ms in iteration N
turn N ends when turn N+1 starts
the last turn ends at root start + event.metrics.rca_duration_mins * 60,000
tool-call time = turn interval - LLM request time
```

Exclude a turn if a required timestamp is absent or its calculated tool-call time is negative. State the excluded count.

Calculate one mean across all included ordinary turn records in each arm. Every turn has equal weight; do not average within each trace first.

## Compare

For every metric:

```text
absolute change = treatment - baseline
percent change  = (treatment - baseline) / baseline * 100
```

Show a leading `+` or `-`. For Judge immediate cause, express absolute change in percentage points (`pp`). When the baseline is zero or either value is unavailable, show percent change as `N/A`.

## Audit before reporting

Verify:

1. Experiment IDs and links exactly match the input roles.
2. Every exact unique `bits_run_id` from the full events appears in the Experiments table.
3. Scenario counts come from unique complete event IDs.
4. Experiment-summary rows come only from `summary.json`.
5. Trace-derived rows use one common set of fully measurable matched pairs.
6. Within the fully measurable matched subset, mean `rca_duration_mins` equals mean LLM time plus mean residual tool time within rounding tolerance. Do not compare that subset identity to the displayed full-population experiment-summary duration.
7. Per-turn rows use explicit agent-loop iterations and contain no finalization-only loop.
8. All arithmetic uses unrounded inputs; round only displayed values.
9. Both snapshot folders exist and contain the four raw data files named above.

Fix any calculation or data-selection error before responding.

## Format the report

Read [references/output.md](references/output.md) and follow it. Include the exact Run ID values and links to both snapshot folders. Do not create an analysis script or add aggregation logic to the downloader.
