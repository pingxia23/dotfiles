---
name: bits-alert-eval-experiment-compare
description: Compare treatment and baseline experiments from a Datadog experiment comparison URL for the LLM Observability project bits-alert-eval-sdk across judge quality, tokens, trace timing, tools, and turns. Reject experiments from every other project during pre-flight.
---

# Bits Alert Eval Experiment Compare

## Input

Accept one Datadog experiment comparison URL and set these immutable values:

```text
treatment_experiment_id = UUID in the /llm/experiments/<UUID> path
base_experiment_id      = UUID in the compareTargetExperimentId query parameter
```

Copy both UUIDs unchanged. Query parameter order does not change these assignments.
Use only `base_experiment_id` and `treatment_experiment_id` when referring to the input experiment IDs in the rest of this workflow.

Use only the Datadog MCP server through `mcp__datadog__*` tools. This is a read-only workflow.

## Mandatory pre-flight

Run every check below before bulk event or trace retrieval:

1. Confirm that the input is one valid Datadog experiment comparison URL and that `base_experiment_id` and `treatment_experiment_id` are valid UUIDs.
2. Call `get_llmobs_experiment_summary` for `base_experiment_id` and `treatment_experiment_id`. Both values must identify readable experiments.
3. For each of `base_experiment_id` and `treatment_experiment_id`, call `list_llmobs_experiment_events(limit: 20)`, then inspect full events with `get_llmobs_experiment_event` until one non-error event with a non-empty agent trace link is found.
4. For `base_experiment_id` and `treatment_experiment_id`, read `project_name` and `project_id` from the full event. If needed, confirm each project with `get_llmobs_project`.
5. Require `project_name == "bits-alert-eval-sdk"` for `base_experiment_id` and `treatment_experiment_id`. Also require their project IDs to match.
6. Require `base_experiment_id` and `treatment_experiment_id` to use the same non-empty dataset ID.
7. Require `deepjudge_score` and `deepjudge_immediate_cause_found` in the summaries for `base_experiment_id` and `treatment_experiment_id`.
8. Require events from `base_experiment_id` and `treatment_experiment_id` to have a shared pairing key: `dataset_record_canonical_id + run_iteration`, or `scenario_uuid + run_iteration` only when the canonical ID is unavailable.
9. Resolve the seed event from `base_experiment_id` and the seed event from `treatment_experiment_id` to one root agent span each by using `output.links.agent_llmobs_trace_url` with `search_llmobs_spans`.

If any check fails, stop before bulk analysis. Return only:

```text
Pre-flight failed
Experiment: <base_experiment_id or treatment_experiment_id>
Check: <failed check>
Observed: <actual value>
Required: <required value>
```

Never run this skill on experiments outside `bits-alert-eval-sdk`.

## Get the data

1. Call `get_llmobs_experiment_summary` for `base_experiment_id` and `treatment_experiment_id`.
2. Page through every `list_llmobs_experiment_events` result. Each result is one scenario run result. Create one `scenario_run_record` per unique result ID. Put `deepjudge_score`, `deepjudge_immediate_cause_found`, pairing fields, and the agent-trace link on that same record. Do not use duplicated summary counts.
3. Match events from `base_experiment_id` and `treatment_experiment_id` by `dataset_record_canonical_id + run_iteration`. Use `scenario_uuid + run_iteration` only when the canonical ID is unavailable.
4. For each scenario run result, read `output.links.agent_llmobs_trace_url`. Do not use the scenario run result's own trace ID; it is usually the evaluator wrapper.
5. Decode the link's `query`, `start`, and `end`, then call `search_llmobs_spans` to resolve the root agent span. Match the returned `session_id`, `investigation_id`, or `source_url` to the link.
6. Call `get_llmobs_trace(include_tree: true)` for each resolved agent trace. Walk the full tree because global child-span search can omit retained spans.
7. Call `get_llmobs_span_details` in trace-scoped batches of at most 20 for the selected LLM and tool spans.
8. Call `get_llmobs_agent_loop` when it provides clearer iteration and tool-call grouping.

Fetch and retain the complete scenario run result before following its agent-trace link. Enrich the same `scenario_run_record` with agent-trace metrics. Do not discard the scores and do not return to the experiment after trace collection.

Use `scenario_run_records` as the only source for every primary comparison metric. Process every record. If an MCP batch is too large, reduce the batch size and continue; never replace the full analysis with an automatic sample.

## Select LLM requests

Count an LLM span only when its parent is not another LLM span:

```text
span.kind == "llm"
AND (parent is absent OR parent.kind != "llm")
```

Example:

```text
generation (llm)          <- count
`-- responses-call (llm) <- ignore
```

A failed outer LLM span counts toward latency even when its token metrics are zero.

## Normalize tokens

For each selected outer LLM request:

```text
total input      = metrics.input_tokens
                   or llm_info.input_tokens
cached input     = metrics.cache_read_input_tokens or 0
non-cached input = total input - cached input
output           = metrics.output_tokens
                   or llm_info.output_tokens
```

Using subtraction makes cache-write and cache-creation tokens part of the non-cached bucket. If total input is absent, derive it from cached input, one cache-write/cache-creation alias, and explicitly reported non-cached input. Do not add both cache-write aliases unless the span proves that they are independent.

Validate `cached + non-cached = total input` for every request.

## Trace-level calculations

Create exactly one `scenario_run_record` per unique scenario run result, then attach the resolved agent-trace measurements to that record. The record contains:

- `deepjudge_score`
- `deepjudge_immediate_cause_found` as 1 for true and 0 for false
- total cached input across its outer LLM requests
- total non-cached input across its outer LLM requests
- total output across its outer LLM requests
- root trace latency
- total outer LLM request time
- residual tool-call time
- executed tool-call count
- ordinary turn count

Keep a scenario run record even when its agent trace cannot be resolved; leave its agent-derived fields null. For token, latency, tool-time, and turn comparisons, use only matched baseline/treatment scenario run records where both agent traces resolved. Use the same matched records for all of those fields. Judge fields remain on the same scenario run records and are averaged from every non-null judge value.

For trace `i`:

```text
trace_latency_i = root agent duration
llm_time_i      = sum(duration of selected outer LLM requests)
tool_time_i     = trace_latency_i - llm_time_i
tool_calls_i    = output.tool_eval.totals.tool_call_count
                  or count(kind == "tool" AND parent.kind != "tool")
turns_i         = explicit agent-loop iteration count
                  or maximum ordinary current_turn
```

`tool_time_i` is a residual. It includes tool execution, orchestration, serialization, retries, retrieval, and gaps.

Only after all scenario run records are complete, calculate each mean from the non-null values of that field in `scenario_run_records`. Do not create a separate judge-event collection or calculate judge metrics from a sample.

```text
mean cached input     = mean(sum cached input per trace) / 1,000
mean non-cached input = mean(sum non-cached input per trace) / 1,000
mean output           = mean(sum output per trace) / 1,000
mean trace latency    = mean(trace_latency_i)
mean LLM request time = mean(llm_time_i)
mean tool-call time   = mean(tool_time_i)
mean tool-call count  = mean(tool_calls_i)
mean turns            = mean(turns_i)
judge mean score      = mean(deepjudge_score)
immediate cause %     = mean(deepjudge_immediate_cause_found) * 100
```

Verify:

```text
mean trace latency = mean LLM request time + mean tool-call time
```

## Per-turn calculations

Derive `turn_records` only from the agent traces attached to `scenario_run_records`. Create one `turn_record` for each ordinary turn.

Use the explicit iteration from `get_llmobs_agent_loop` when available. Otherwise use `current_turn` on the outer LLM span. Do not equate request count with turn count because retries can create more than one LLM request in a turn.

Partition each trace into chronological turn intervals:

```text
turn 1 starts at the root agent start
turn N starts at the first outer LLM request for turn N
turn N ends when turn N+1 starts
the last turn ends at the root agent end
```

Create exactly one metric record for every ordinary turn in every included trace. Forced-conclusion requests remain in the trace-level LLM total but are not ordinary turns and are excluded from the per-turn average.

For each trace and turn:

```text
cached input       = sum cached input for outer LLM requests in the turn
non-cached input   = sum non-cached input for outer LLM requests in the turn
LLM request time   = sum outer LLM request duration in the turn
tool-call time     = turn interval duration - LLM request time
tool-call count    = executed tool calls assigned to the turn
LLM request latency = LLM request time / outer LLM request count
```

Prefer tool calls grouped by iteration in the scenario run result or agent loop. Otherwise count spans where `kind == "tool"` and the parent kind is not `tool`, assigning each by start time to its turn interval.

After collecting all turn records, calculate one mean for each field across all turn records in the arm:

```text
mean cached input per turn
mean non-cached input per turn
mean LLM request time per turn
mean tool-call time per turn
mean tool-call count per turn
mean LLM request latency per turn
```

Every turn has equal weight. Do not group by turn number. Do not produce separate rows for turn 1, turn 2, and so on. Do not first average turns within each trace.

## Mandatory final audit

Run these assertions immediately before writing the response:

1. The baseline ID in the Experiments table and its link path exactly equal `base_experiment_id`.
2. The treatment ID in the Experiments table and its link path exactly equal `treatment_experiment_id`.
3. The two roles have not been swapped.
4. Both displayed project names equal bits-alert-eval-sdk and both project IDs match.
5. scenario_run_records contains every paginated unique scenario run result exactly once.
6. The displayed Judge mean score equals the mean of scenario_run_records.deepjudge_score for that arm.
7. The displayed Judge immediate cause equals mean(scenario_run_records.deepjudge_immediate_cause_found) * 100 for that arm.
8. No primary metric was computed from a sampled subset. If a batch failed, it was retried with a smaller batch.
9. The response states the scenario-run-record and ordinary-turn counts.
10. For each arm, displayed mean trace latency equals displayed mean LLM time plus displayed mean tool time within rounding tolerance.
11. The displayed mean tool-call count equals the mean of scenario_run_records.tool_calls_i over the same matched records used for the other agent-derived trace metrics.

If an assertion fails, fix the data or calculation before responding. Do not publish a best-effort table with a known failed assertion.

## Output

Return only the three sections below, plus one short sentence stating the main result.

For every comparison row:

```text
absolute change = treatment - baseline
percent change  = (treatment - baseline) / baseline * 100
```

Show a leading `+` or `-` on both changes. For Judge immediate cause, express the absolute change in percentage points (`pp`) and calculate percent change from the underlying percentages. If the baseline is zero, show percent change as `N/A`.

### Experiments

Always show the exact experiments before any metrics:

| Role | Experiment | Project | Dataset | Scenario run records | Agent traces resolved |
|---|---|---|---|---:|---:|
| Baseline | [`<base_experiment_id>`](https://app.datadoghq.com/llm/experiments/<base_experiment_id>) | `bits-alert-eval-sdk` | `<dataset ID>` | | |
| Treatment | [`<treatment_experiment_id>`](https://app.datadoghq.com/llm/experiments/<treatment_experiment_id>) | `bits-alert-eval-sdk` | `<dataset ID>` | | |

Do not shorten, swap, or reconstruct the IDs from trace metadata. Use `base_experiment_id` and `treatment_experiment_id` exactly as set from the input URL.

### Primary comparison

State the total scenario-run-record count for each arm and the number of matched scenario run records with resolved agent traces. Do not describe judge scores or immediate-cause values as separate event populations.

| Metric | Baseline | Treatment | Absolute change | % change |
|---|---:|---:|---:|---:|
| Judge mean score | | | | |
| Judge immediate cause (%) | | | pp | |
| Mean input cached tokens (K) | | | | |
| Mean input non-cached tokens (K) | | | | |
| Mean output tokens (K) | | | | |
| Mean trace latency (min) | | | | |
| Mean LLM request time (min/trace) | | | | |
| Mean tool-call time (min/trace) | | | | |
| Mean tool-call count (calls/trace) | | | | |
| Mean turn count | | | | |

### Per-turn deep dive

State the number of ordinary turn records included for each arm, then produce one comparison table:

| Metric per turn | Baseline | Treatment | Absolute change | % change |
|---|---:|---:|---:|---:|
| Mean cached input tokens (K/turn) | | | | |
| Mean non-cached input tokens (K/turn) | | | | |
| Mean LLM request time (s/turn) | | | | |
| Mean tool-call time (s/turn) | | | | |
| Mean tool-call count (calls/turn) | | | | |
| Mean LLM request latency (s/request) | | | | |

Always include this footnote after the per-turn tables when event or agent-loop tool grouping is unavailable:

> ¹Tool-call count was inferred by counting tool spans whose parent is not another tool span.
