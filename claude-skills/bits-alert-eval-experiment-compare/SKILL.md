---
name: bits-alert-eval-experiment-compare
description: Compare treatment and baseline experiments from a Datadog comparison URL for the bits-alert-eval-sdk project across judge quality, experiment cost, and RCA-bounded tokens, timing, tools, and turns.
---

# Bits Alert Eval Experiment Compare

This is a read-only workflow. Use `scripts/compare_experiments.py`; it retrieves and processes data through the `pup` CLI. Do not repeat its work through Datadog MCP tools.

## Resolve input

Accept one Datadog experiment comparison URL:

```text
treatment_experiment_id = UUID in /llm/experiments/<UUID>
base_experiment_id      = UUID in compareTargetExperimentId
```

Copy both IDs unchanged. Query parameter order does not change their roles. Refer to them only by these variable names.

## Run the script

From this skill directory, run:

```bash
python3 scripts/compare_experiments.py '<comparison URL>'
```

The script validates the input, downloads the data, calculates the comparison, and audits the result. It prints the comparison as JSON together with the snapshot ID and both snapshot folder paths. If the command fails, stop and report the script error.

If the command is interrupted, rerun it with the snapshot ID from the first run:

```bash
python3 scripts/compare_experiments.py '<comparison URL>' --snapshot-id '<snapshot ID>'
```

## Format the result

Format the script's JSON using [references/output.md](references/output.md). Include the exact Run ID values and links to both snapshot folders. Do not redo the script's calculations.
