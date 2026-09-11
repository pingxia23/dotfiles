#!/usr/bin/env python3

import argparse
import concurrent.futures
import datetime
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path
from statistics import fmean
from typing import Any


UUID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("comparison_url")
    parser.add_argument(
        "--data-root",
        type=Path,
        default=Path.home() / ".codex/data/bits-alert-eval-experiment-compare",
    )
    parser.add_argument("--snapshot-id")
    parser.add_argument("--concurrency", type=int, default=12)
    parser.add_argument("--from-time", default="1week")
    parser.add_argument("--to-time", default="now")
    return parser.parse_args()


def parse_comparison_url(value: str) -> tuple[str, str]:
    parsed = urllib.parse.urlparse(value)
    match = re.fullmatch(r"/llm/experiments/([^/]+)", parsed.path)
    query = urllib.parse.parse_qs(parsed.query)
    if parsed.scheme != "https" or parsed.netloc != "app.datadoghq.com" or not match:
        raise ValueError("input must be one Datadog experiment comparison URL")
    treatment_id = match.group(1)
    base_values = query.get("compareTargetExperimentId", [])
    if len(base_values) != 1:
        raise ValueError("compareTargetExperimentId must occur exactly once")
    base_id = base_values[0]
    if not UUID_PATTERN.fullmatch(base_id) or not UUID_PATTERN.fullmatch(treatment_id):
        raise ValueError("both experiment IDs must be UUIDs")
    return base_id, treatment_id


def parse_json_output(stdout: str) -> Any:
    stripped = stdout.strip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        starts = [index for index in (stripped.find("{"), stripped.find("[")) if index >= 0]
        if not starts:
            raise
        return json.loads(stripped[min(starts) :])


def pup(arguments: list[str], attempts: int = 8) -> Any:
    command = ["pup", "llm-obs", *arguments, "--read-only", "--output", "json"]
    wait_seconds = 2
    for attempt in range(attempts):
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        if result.returncode == 0:
            return parse_json_output(result.stdout)
        combined = f"{result.stdout}\n{result.stderr}".lower()
        if "auth" in combined and "429" not in combined:
            raise RuntimeError("pup authentication failed; run `pup auth login` and retry")
        if attempt == attempts - 1:
            raise RuntimeError(
                f"pup failed after {attempts} attempts: {' '.join(command)}\n{result.stderr.strip()}"
            )
        time.sleep(wait_seconds)
        wait_seconds = min(wait_seconds * 2, 30)
    raise AssertionError("unreachable")


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    with temporary.open("w", encoding="utf-8") as output:
        json.dump(value, output, indent=2, sort_keys=True)
        output.write("\n")
    os.replace(temporary, path)


def atomic_jsonl(path: Path, values: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    with temporary.open("w", encoding="utf-8") as output:
        for value in values:
            output.write(json.dumps(value, separators=(",", ":"), sort_keys=True))
            output.write("\n")
    os.replace(temporary, path)


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8") as source:
        return [json.loads(line) for line in source if line.strip()]


def metric(summary: dict[str, Any], kind: str, name: str) -> Any:
    return summary.get("evals", {}).get(kind, {}).get(name)


def list_events(experiment_id: str, limit: int, offset: int, **filters: str) -> dict[str, Any]:
    arguments = [
        "experiments",
        "events",
        "list",
        experiment_id,
        "--limit",
        str(limit),
        "--offset",
        str(offset),
    ]
    for key, value in filters.items():
        arguments.extend([f"--{key.replace('_', '-')}", value])
    return pup(arguments)


def get_event(experiment_id: str, event_id: str) -> dict[str, Any]:
    return pup(["experiments", "events", "get", experiment_id, event_id])


def link_parameters(link: str) -> dict[str, str]:
    parsed = urllib.parse.urlparse(link)
    return {key: values[-1] for key, values in urllib.parse.parse_qs(parsed.query).items()}


def root_spans(query: str, from_time: str, to_time: str, limit: int = 5000) -> list[dict[str, Any]]:
    spans: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:
        arguments = [
            "spans",
            "search",
            "--query",
            query,
            "--span-kind",
            "agent",
            "--root-spans-only",
            "--from",
            from_time,
            "--to",
            to_time,
            "--limit",
            str(limit),
        ]
        if cursor:
            arguments.extend(["--cursor", cursor])
        page = pup(arguments)
        spans.extend(page.get("spans", []))
        cursor = page.get("cursor") or page.get("next_cursor")
        if not cursor:
            return spans


def resolve_seed(event: dict[str, Any], from_time: str, to_time: str) -> dict[str, Any]:
    link = event.get("output", {}).get("links", {}).get("agent_llmobs_trace_url")
    if not link:
        raise ValueError("seed event has no agent trace link")
    parameters = link_parameters(link)
    query = parameters.get("query")
    if not query:
        raise ValueError("seed agent trace link has no query")
    roots = root_spans(
        query,
        parameters.get("start") or parameters.get("from_ts") or from_time,
        parameters.get("end") or parameters.get("to_ts") or to_time,
        limit=20,
    )
    roots = [span for span in roots if str(span.get("parent_id")) in {"None", "undefined"}]
    if len(roots) != 1:
        raise ValueError(f"seed link resolved to {len(roots)} root spans")
    return roots[0]


def event_pair_key(event: dict[str, Any]) -> str:
    dimensions = event.get("dimensions", {})
    record_id = dimensions.get("dataset_record_canonical_id") or dimensions.get("scenario_uuid")
    return f"{record_id}::{dimensions.get('run_iteration')}"


def preflight(
    base_id: str,
    treatment_id: str,
    from_time: str,
    to_time: str,
) -> dict[str, Any]:
    summaries: dict[str, dict[str, Any]] = {}
    seeds: dict[str, dict[str, Any]] = {}
    roots: dict[str, dict[str, Any]] = {}
    for role, experiment_id in (("base", base_id), ("treatment", treatment_id)):
        summary = pup(["experiments", "summary", experiment_id])
        if summary.get("experiment_id") != experiment_id:
            raise ValueError(f"{role} experiment is not readable")
        for kind, name in (
            ("score", "deepjudge_score"),
            ("categorical", "deepjudge_immediate_cause_found"),
            ("score", "total_cost_cents"),
            ("score", "cache_read_input_tokens"),
            ("score", "cache_creation_input_tokens"),
            ("score", "output_tokens"),
            ("score", "rca_duration_mins"),
        ):
            if not metric(summary, kind, name):
                raise ValueError(f"{role} summary is missing {name}")
        first_page = list_events(experiment_id, 20, 0)
        seed = None
        for item in first_page.get("events", []):
            if item.get("status") != "ok":
                continue
            candidate = get_event(experiment_id, str(item["id"]))
            if candidate.get("output", {}).get("links", {}).get("agent_llmobs_trace_url"):
                seed = candidate
                break
        if seed is None:
            raise ValueError(f"{role} has no non-error seed with an agent trace link")
        dimensions = seed.get("dimensions", {})
        if dimensions.get("project_name") != "bits-alert-eval-sdk":
            raise ValueError(f"{role} project is {dimensions.get('project_name')!r}")
        if not dimensions.get("bits_run_id"):
            raise ValueError(f"{role} seed has no bits_run_id")
        summaries[role] = summary
        seeds[role] = seed
        roots[role] = resolve_seed(seed, from_time, to_time)

    base_dimensions = seeds["base"].get("dimensions", {})
    treatment_dimensions = seeds["treatment"].get("dimensions", {})
    if base_dimensions.get("project_id") != treatment_dimensions.get("project_id"):
        raise ValueError("project IDs do not match")
    dataset_id = summaries["base"].get("dataset_id")
    if not dataset_id or dataset_id != summaries["treatment"].get("dataset_id"):
        raise ValueError("dataset IDs are empty or do not match")

    canonical_id = base_dimensions.get("dataset_record_canonical_id")
    matching = list_events(
        treatment_id,
        20,
        0,
        filter_dimension_key="dataset_record_canonical_id",
        filter_dimension_value=str(canonical_id),
    )
    treatment_pair_found = False
    for item in matching.get("events", []):
        candidate = get_event(treatment_id, str(item["id"]))
        if event_pair_key(candidate) == event_pair_key(seeds["base"]):
            treatment_pair_found = True
            break
    if not treatment_pair_found:
        raise ValueError("no shared pairing key was found")
    return {"summaries": summaries, "seeds": seeds, "roots": roots}


def compact_event(event: dict[str, Any]) -> dict[str, Any]:
    dimensions = event.get("dimensions", {})
    output = event.get("output", {})
    tool_eval = output.get("tool_eval", {})
    metrics = event.get("metrics", {})
    immediate = metrics.get("deepjudge_immediate_cause_found")
    if isinstance(immediate, str):
        immediate = 1 if immediate.lower() == "true" else 0 if immediate.lower() == "false" else None
    elif isinstance(immediate, bool):
        immediate = int(immediate)
    return {
        "id": str(event.get("id")),
        "status": event.get("status"),
        "deepjudge_score": metrics.get("deepjudge_score"),
        "deepjudge_immediate_cause_found": immediate,
        "total_cost_cents": metrics.get("total_cost_cents"),
        "rca_duration_mins": metrics.get("rca_duration_mins"),
        "event_cache_read_input_tokens": metrics.get("cache_read_input_tokens"),
        "event_cache_creation_input_tokens": metrics.get("cache_creation_input_tokens"),
        "event_input_tokens": metrics.get("input_tokens"),
        "event_output_tokens": metrics.get("output_tokens"),
        "dataset_record_canonical_id": dimensions.get("dataset_record_canonical_id"),
        "scenario_uuid": dimensions.get("scenario_uuid") or dimensions.get("input.scenario.uuid"),
        "run_iteration": str(dimensions.get("run_iteration", "")),
        "bits_run_id": dimensions.get("bits_run_id"),
        "project_id": dimensions.get("project_id"),
        "project_name": dimensions.get("project_name"),
        "dataset_id": dimensions.get("dataset_id"),
        "agent_trace_url": output.get("links", {}).get("agent_llmobs_trace_url"),
        "event_tool_call_count": tool_eval.get("totals", {}).get("tool_call_count"),
        "event_tool_calls": [
            {
                "call_id": call.get("call_id"),
                "iteration": call.get("iteration"),
                "order_index": call.get("order_index"),
                "status": call.get("status"),
            }
            for call in tool_eval.get("tool_calls", [])
        ]
        if isinstance(tool_eval.get("tool_calls"), list)
        else None,
    }


def collect_events(
    experiment_id: str,
    expected_count: int,
    folder: Path,
    concurrency: int,
) -> list[dict[str, Any]]:
    output_path = folder / "scenario-runs.jsonl"
    if output_path.exists():
        records = read_jsonl(output_path)
        if len(records) != expected_count:
            raise ValueError(f"saved scenario count {len(records)} != {expected_count}")
        required_metrics = {
            "event_cache_read_input_tokens",
            "event_cache_creation_input_tokens",
            "event_input_tokens",
            "event_output_tokens",
        }
        if any(not required_metrics.issubset(record) for record in records):
            log(f"Enriching saved event records with RCA token totals for {experiment_id}")
            offsets = list(range(0, expected_count, 20))
            with concurrent.futures.ThreadPoolExecutor(max_workers=min(concurrency, 8)) as executor:
                pages = list(executor.map(lambda offset: list_events(experiment_id, 20, offset), offsets))
            listed = {
                str(item["id"]): item.get("metrics", {})
                for page in pages
                for item in page.get("events", [])
            }
            for record in records:
                metrics = listed[record["id"]]
                record.update(
                    {
                        "total_cost_cents": metrics.get("total_cost_cents"),
                        "event_cache_read_input_tokens": metrics.get("cache_read_input_tokens"),
                        "event_cache_creation_input_tokens": metrics.get("cache_creation_input_tokens"),
                        "event_input_tokens": metrics.get("input_tokens"),
                        "event_output_tokens": metrics.get("output_tokens"),
                    }
                )
            atomic_jsonl(output_path, records)
        log(f"Loaded {len(records)} saved scenario records for {experiment_id}")
        return records

    log(f"Listing {expected_count} events for {experiment_id}")
    offsets = list(range(0, expected_count, 20))
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(concurrency, 8)) as executor:
        pages = list(executor.map(lambda offset: list_events(experiment_id, 20, offset), offsets))
    event_ids: list[str] = []
    seen: set[str] = set()
    for page in pages:
        for item in page.get("events", []):
            event_id = str(item["id"])
            if event_id not in seen:
                seen.add(event_id)
                event_ids.append(event_id)
    if len(event_ids) != expected_count:
        raise ValueError(f"listed {len(event_ids)} unique events, expected {expected_count}")

    checkpoint = folder / "checkpoints/events"
    checkpoint.mkdir(parents=True, exist_ok=True)

    def fetch(event_id: str) -> dict[str, Any]:
        path = checkpoint / f"{event_id}.json"
        if path.exists():
            with path.open(encoding="utf-8") as source:
                return json.load(source)
        record = compact_event(get_event(experiment_id, event_id))
        atomic_json(path, record)
        return record

    records_by_id: dict[str, dict[str, Any]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = {executor.submit(fetch, event_id): event_id for event_id in event_ids}
        for completed, future in enumerate(concurrent.futures.as_completed(futures), start=1):
            event_id = futures[future]
            records_by_id[event_id] = future.result()
            if completed % 100 == 0 or completed == len(event_ids):
                log(f"Downloaded {completed}/{len(event_ids)} complete events for {experiment_id}")
    records = [records_by_id[event_id] for event_id in event_ids]
    atomic_jsonl(output_path, records)
    return records


def tag_values(tags: list[str] | None) -> dict[str, str]:
    values: dict[str, str] = {}
    for tag in tags or []:
        key, separator, value = tag.partition(":")
        if separator:
            values[key] = value
    return values


def identifiers_from_link(link: str | None) -> set[str]:
    if not link:
        return set()
    query = link_parameters(link).get("query", "")
    identifiers: set[str] = set()
    for key in ("trace_id", "session_id", "investigation_id", "source_url"):
        pattern = re.compile(rf'{key}:"?([^"\s\)]+)')
        identifiers.update(f"{key}:{match}" for match in pattern.findall(query))
    return identifiers


def collect_root_references(
    records: list[dict[str, Any]],
    from_time: str,
    to_time: str,
) -> list[dict[str, Any]]:
    roots: list[dict[str, Any]] = []
    for run_id in sorted({record["bits_run_id"] for record in records if record.get("bits_run_id")}):
        roots.extend(root_spans(f'@tags:"eval_bits_run_id:{run_id}"', from_time, to_time))
    log(f"Bulk root search returned {len(roots)} candidates")
    index: dict[str, list[dict[str, Any]]] = {}
    for root in roots:
        tags = tag_values(root.get("tags"))
        values = {
            "trace_id": str(root.get("trace_id")),
            "session_id": tags.get("session_id"),
            "investigation_id": tags.get("investigation_id"),
            "source_url": tags.get("source_url"),
        }
        for key, value in values.items():
            if value:
                index.setdefault(f"{key}:{value}", []).append(root)

    references: list[dict[str, Any]] = []
    for record in records:
        if not record.get("agent_trace_url"):
            references.append({"id": record["id"], "state": "missing_link"})
            continue
        candidates: dict[str, dict[str, Any]] = {}
        for identifier in identifiers_from_link(record["agent_trace_url"]):
            for root in index.get(identifier, []):
                candidates[str(root["span_id"])] = root
        if len(candidates) != 1:
            parameters = link_parameters(record["agent_trace_url"])
            query = parameters.get("query")
            fallback = root_spans(
                query,
                parameters.get("start") or parameters.get("from_ts") or from_time,
                parameters.get("end") or parameters.get("to_ts") or to_time,
                limit=20,
            )
            candidates = {str(root["span_id"]): root for root in fallback}
        if len(candidates) != 1:
            references.append({"id": record["id"], "state": "unresolved_root"})
            continue
        root = next(iter(candidates.values()))
        start_ms = float(root["start_ms"])
        duration_ms = float(root["duration_ms"])
        references.append(
            {
                "id": record["id"],
                "state": "resolved",
                "trace_id": str(root["trace_id"]),
                "root_span_id": str(root["span_id"]),
                "root_start_ms": start_ms,
                "root_duration_ms": duration_ms,
                "from": str(int(start_ms - 300_000)),
                "to": str(int(start_ms + duration_ms + 300_000)),
            }
        )
    return references


def walk_tree(
    node: dict[str, Any],
    parent_kind: str | None,
    path: list[str],
    state: dict[str, Any],
) -> None:
    span_id = str(node.get("span_id"))
    kind = node.get("kind")
    current_path = [*path, str(node.get("name", ""))]
    state["kind_by_id"][span_id] = kind
    if kind == "agent":
        state["agent_paths"][span_id] = current_path
    if kind == "llm" and parent_kind != "llm":
        state["outer_llm_ids"].add(span_id)
    if kind == "tool" and parent_kind != "tool":
        state["outer_tool_ids"].add(span_id)
    for child in node.get("children", []):
        walk_tree(child, kind, current_path, state)


def get_span_details(reference: dict[str, Any], span_ids: list[str]) -> list[dict[str, Any]]:
    details: list[dict[str, Any]] = []
    for index in range(0, len(span_ids), 20):
        batch = span_ids[index : index + 20]
        result = pup(
            [
                "spans",
                "get-details",
                "--trace-id",
                reference["trace_id"],
                "--span-ids",
                ",".join(batch),
                "--from",
                reference["from"],
                "--to",
                reference["to"],
            ]
        )
        details.extend(result.get("spans", []))
    return details


def tag_value(tags: list[str] | None, key: str) -> str | None:
    prefix = f"{key}:"
    return next((tag[len(prefix) :] for tag in tags or [] if tag.startswith(prefix)), None)


def normalize_tokens(span: dict[str, Any]) -> dict[str, float]:
    metrics = span.get("metrics", {})
    llm_info = span.get("llm_info", {})
    cached = float(metrics.get("cache_read_input_tokens") or 0)
    total = metrics.get("input_tokens")
    if total is None:
        total = llm_info.get("input_tokens")
    if total is None:
        total = (
            cached
            + float(metrics.get("cache_write_input_tokens") or metrics.get("cache_creation_input_tokens") or 0)
            + float(metrics.get("non_cached_input_tokens") or 0)
        )
    total = float(total)
    noncached = total - cached
    if abs(cached + noncached - total) > 1e-9:
        raise ValueError(f"token normalization failed for {span.get('span_id')}")
    output = metrics.get("output_tokens")
    if output is None:
        output = llm_info.get("output_tokens")
    return {"cached": cached, "noncached": noncached, "output": float(output or 0)}


def search_trace_llms(reference: dict[str, Any]) -> list[dict[str, Any]]:
    spans: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:
        arguments = [
            "spans",
            "search",
            "--trace-id",
            reference["trace_id"],
            "--span-kind",
            "llm",
            "--from",
            reference["from"],
            "--to",
            reference["to"],
            "--limit",
            "500",
            "--summary",
        ]
        if cursor:
            arguments.extend(["--cursor", cursor])
        page = pup(arguments)
        spans.extend(page.get("spans", []))
        cursor = page.get("cursor") or page.get("next_cursor")
        if not cursor:
            return spans


def measure_trace(
    record: dict[str, Any],
    reference: dict[str, Any],
) -> dict[str, Any]:
    if reference["state"] != "resolved":
        return {"id": record["id"], "trace_resolved": False, "trace_complete": False, "reason": reference["state"]}
    if record.get("rca_duration_mins") is None:
        return {"id": record["id"], "trace_resolved": True, "trace_complete": False, "reason": "missing_rca_duration"}

    trace = pup(
        [
            "spans",
            "get-trace",
            "--trace-id",
            reference["trace_id"],
            "--include-tree",
            "--from",
            reference["from"],
            "--to",
            reference["to"],
        ]
    )
    state = {
        "kind_by_id": {},
        "agent_paths": {},
        "outer_llm_ids": set(),
        "outer_tool_ids": set(),
    }
    walk_tree(trace["root_span"], None, [], state)
    rca_start = float(reference["root_start_ms"])
    total_duration = float(record["rca_duration_mins"]) * 60_000
    rca_end = rca_start + total_duration

    searched_llms = search_trace_llms(reference)
    known_llm_ids = {
        span_id for span_id, kind in state["kind_by_id"].items() if kind == "llm"
    }
    known_llm_ids.update(str(span["span_id"]) for span in searched_llms)
    candidates = set(state["outer_llm_ids"])
    missing_outer: set[str] = set()
    for span in searched_llms:
        span_id = str(span["span_id"])
        parent_id = str(span.get("parent_id", ""))
        start_ms = float(span.get("start_ms") or 0)
        if span.get("name") in {"messages-call", "responses-call"} and parent_id not in known_llm_ids:
            if start_ms < rca_end:
                missing_outer.add(parent_id)
        elif parent_id not in known_llm_ids and start_ms < rca_end:
            candidates.add(span_id)
    if missing_outer:
        return {
            "id": record["id"],
            "trace_resolved": True,
            "trace_complete": False,
            "reason": "missing_outer_llm_retention",
            "missing_outer_llm": len(missing_outer),
        }

    need_tool_fallback = record.get("event_tool_call_count") is None or record.get("event_tool_calls") is None
    detail_ids = sorted(candidates | (state["outer_tool_ids"] if need_tool_fallback else set()))
    details = get_span_details(reference, detail_ids)
    by_id = {str(span["span_id"]): span for span in details}
    if any(span_id not in by_id for span_id in detail_ids):
        return {"id": record["id"], "trace_resolved": True, "trace_complete": False, "reason": "missing_span_details"}

    selected_llms: list[dict[str, Any]] = []
    for span_id in candidates:
        span = by_id[span_id]
        if span.get("kind") != "llm" or str(span.get("parent_id", "")) in known_llm_ids:
            continue
        start_ms = float(span["start_ms"])
        duration_ms = float(span["duration_ms"])
        end_ms = start_ms + duration_ms
        if start_ms >= rca_end:
            continue
        if start_ms < rca_start or end_ms > rca_end:
            return {"id": record["id"], "trace_resolved": True, "trace_complete": False, "reason": "span_crosses_rca_boundary"}
        parent_id = str(span.get("parent_id", ""))
        path = state["agent_paths"].get(parent_id, [])
        selected_llms.append(
            {
                "span_id": span_id,
                "parent_id": parent_id,
                "start_ms": start_ms,
                "end_ms": end_ms,
                "duration_ms": duration_ms,
                "turn": int(tag_value(span.get("tags"), "current_turn") or 0),
                "forced": any("force_conclusion" in name.lower() for name in path),
                **normalize_tokens(span),
            }
        )

    groups: dict[str, list[dict[str, Any]]] = {}
    for span in selected_llms:
        if span["turn"] > 0 and not span["forced"]:
            groups.setdefault(span["parent_id"], []).append(span)
    if not groups:
        return {"id": record["id"], "trace_resolved": True, "trace_complete": False, "reason": "no_ordinary_turns"}
    ordinary = min(groups.values(), key=lambda spans: min(span["start_ms"] for span in spans))
    turns = max(span["turn"] for span in ordinary)
    by_turn: dict[int, list[dict[str, Any]]] = {}
    for span in ordinary:
        by_turn.setdefault(span["turn"], []).append(span)
    missing_turns = [turn for turn in range(1, turns + 1) if turn not in by_turn]
    if missing_turns:
        return {
            "id": record["id"],
            "trace_resolved": True,
            "trace_complete": False,
            "reason": "ordinary_turn_gap",
            "missing_turns": missing_turns,
        }

    tool_details = [by_id[span_id] for span_id in state["outer_tool_ids"]] if need_tool_fallback else []
    selected_tools: list[dict[str, float]] = []
    for span in tool_details:
        start_ms = float(span["start_ms"])
        duration_ms = float(span["duration_ms"])
        end_ms = start_ms + duration_ms
        if start_ms >= rca_end:
            continue
        if start_ms < rca_start or end_ms > rca_end:
            return {"id": record["id"], "trace_resolved": True, "trace_complete": False, "reason": "span_crosses_rca_boundary"}
        selected_tools.append({"start_ms": start_ms, "end_ms": end_ms})

    turn_starts = {1: rca_start}
    for turn in range(2, turns + 1):
        turn_starts[turn] = min(span["start_ms"] for span in by_turn[turn])
    turn_records: list[dict[str, Any]] = []
    for turn in range(1, turns + 1):
        spans = by_turn[turn]
        interval_end = turn_starts[turn + 1] if turn < turns else rca_end
        llm_ms = sum(span["duration_ms"] for span in spans)
        if need_tool_fallback:
            tool_calls = sum(
                1 for tool in selected_tools if turn_starts[turn] <= tool["start_ms"] < interval_end
            )
        else:
            tool_calls = sum(
                1
                for call in record["event_tool_calls"]
                if int(call.get("iteration") or 0) == turn
            )
        turn_records.append(
            {
                "turn": turn,
                "cached": sum(span["cached"] for span in spans),
                "noncached": sum(span["noncached"] for span in spans),
                "llm_ms": llm_ms,
                "tool_ms": interval_end - turn_starts[turn] - llm_ms,
                "tool_calls": tool_calls,
                "llm_request_latency_ms": llm_ms / len(spans),
            }
        )

    llm_ms = sum(span["duration_ms"] for span in selected_llms)
    return {
        "id": record["id"],
        "trace_resolved": True,
        "trace_complete": True,
        "trace_id": reference["trace_id"],
        "root_span_id": reference["root_span_id"],
        "rca_start_ms": rca_start,
        "rca_end_ms": rca_end,
        "total_duration_ms": total_duration,
        "cached_input": sum(span["cached"] for span in selected_llms),
        "noncached_input": sum(span["noncached"] for span in selected_llms),
        "output_tokens": sum(span["output"] for span in selected_llms),
        "llm_time_ms": llm_ms,
        "tool_time_ms": total_duration - llm_ms,
        "tool_calls": len(selected_tools) if need_tool_fallback else record["event_tool_call_count"],
        "turns": turns,
        "outer_llms": selected_llms,
        "turn_records": turn_records,
        "tool_count_inferred": need_tool_fallback,
    }


def collect_traces(
    records: list[dict[str, Any]],
    references: list[dict[str, Any]],
    folder: Path,
    concurrency: int,
) -> list[dict[str, Any]]:
    output_path = folder / "trace-records.jsonl"
    if output_path.exists():
        traces = read_jsonl(output_path)
        log(f"Loaded {len(traces)} saved trace records from {folder}")
        return traces
    reference_by_id = {reference["id"]: reference for reference in references}
    checkpoint = folder / "checkpoints/traces"
    checkpoint.mkdir(parents=True, exist_ok=True)

    def fetch(record: dict[str, Any]) -> dict[str, Any]:
        path = checkpoint / f"{record['id']}.json"
        if path.exists():
            with path.open(encoding="utf-8") as source:
                return json.load(source)
        reference = reference_by_id[record["id"]]
        trace = measure_trace(record, reference)
        atomic_json(path, trace)
        return trace

    traces_by_id: dict[str, dict[str, Any]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = {executor.submit(fetch, record): record["id"] for record in records}
        for completed, future in enumerate(concurrent.futures.as_completed(futures), start=1):
            record_id = futures[future]
            traces_by_id[record_id] = future.result()
            if completed % 50 == 0 or completed == len(records):
                complete = sum(trace.get("trace_complete", False) for trace in traces_by_id.values())
                log(f"Measured {completed}/{len(records)} traces from {folder}; complete RCA windows: {complete}")
    traces = [traces_by_id[record["id"]] for record in records]
    atomic_jsonl(output_path, traces)
    return traces


def pairing_key(record: dict[str, Any]) -> str:
    record_id = record.get("dataset_record_canonical_id") or record.get("scenario_uuid")
    return f"{record_id}::{record.get('run_iteration')}"


def mean(values: list[float]) -> float:
    if not values:
        raise ValueError("cannot calculate a mean from no values")
    return fmean(values)


def summary_true_percentage(summary: dict[str, Any], name: str) -> float:
    value = metric(summary, "categorical", name)
    counts = {str(item["value"]).lower(): int(item["count"]) for item in value["top_values"]}
    total = sum(counts.values())
    if total == 0:
        raise ValueError(f"summary metric {name} has no values")
    return counts.get("true", 0) / total * 100


def experiment_summary_stats(summary: dict[str, Any]) -> dict[str, float]:
    return {
        "cached_k": float(metric(summary, "score", "cache_read_input_tokens")["mean"])
        / 1_000,
        "noncached_k": float(
            metric(summary, "score", "cache_creation_input_tokens")["mean"]
        )
        / 1_000,
        "output_k": float(metric(summary, "score", "output_tokens")["mean"]) / 1_000,
        "total_duration_min": float(metric(summary, "score", "rca_duration_mins")["mean"]),
    }


def arm_trace_stats(traces: list[dict[str, Any]]) -> dict[str, float]:
    return {
        "cached_k": mean([trace["cached_input"] for trace in traces]) / 1_000,
        "noncached_k": mean([trace["noncached_input"] for trace in traces]) / 1_000,
        "output_k": mean([trace["output_tokens"] for trace in traces]) / 1_000,
        "total_duration_min": mean([trace["total_duration_ms"] for trace in traces]) / 60_000,
        "llm_min": mean([trace["llm_time_ms"] for trace in traces]) / 60_000,
        "tool_min": mean([trace["tool_time_ms"] for trace in traces]) / 60_000,
        "tool_calls": mean([float(trace["tool_calls"]) for trace in traces]),
        "turns": mean([float(trace["turns"]) for trace in traces]),
    }


def arm_turn_stats(turns: list[dict[str, Any]]) -> dict[str, float]:
    return {
        "cached_k": mean([turn["cached"] for turn in turns]) / 1_000,
        "noncached_k": mean([turn["noncached"] for turn in turns]) / 1_000,
        "llm_s": mean([turn["llm_ms"] for turn in turns]) / 1_000,
        "tool_s": mean([turn["tool_ms"] for turn in turns]) / 1_000,
        "tool_calls": mean([float(turn["tool_calls"]) for turn in turns]),
        "llm_latency_s": mean([turn["llm_request_latency_ms"] for turn in turns]) / 1_000,
    }


def analyze(
    base_summary: dict[str, Any],
    treatment_summary: dict[str, Any],
    base_records: list[dict[str, Any]],
    treatment_records: list[dict[str, Any]],
    base_traces: list[dict[str, Any]],
    treatment_traces: list[dict[str, Any]],
) -> dict[str, Any]:
    base_by_key = {pairing_key(record): record for record in base_records}
    treatment_by_key = {pairing_key(record): record for record in treatment_records}
    base_trace_by_id = {trace["id"]: trace for trace in base_traces}
    treatment_trace_by_id = {trace["id"]: trace for trace in treatment_traces}
    shared_keys = sorted(set(base_by_key) & set(treatment_by_key))
    measurable_keys = [
        key
        for key in shared_keys
        if base_trace_by_id[base_by_key[key]["id"]].get("trace_complete")
        and treatment_trace_by_id[treatment_by_key[key]["id"]].get("trace_complete")
    ]
    base_measured = [base_trace_by_id[base_by_key[key]["id"]] for key in measurable_keys]
    treatment_measured = [
        treatment_trace_by_id[treatment_by_key[key]["id"]] for key in measurable_keys
    ]
    base_turns = [turn for trace in base_measured for turn in trace["turn_records"]]
    treatment_turns = [turn for trace in treatment_measured for turn in trace["turn_records"]]

    result = {
        "counts": {
            "base_records": len(base_records),
            "treatment_records": len(treatment_records),
            "shared_pairing_keys": len(shared_keys),
            "matched_root_traces_resolved": sum(
                1
                for key in shared_keys
                if base_trace_by_id[base_by_key[key]["id"]].get("trace_resolved")
                and treatment_trace_by_id[treatment_by_key[key]["id"]].get("trace_resolved")
            ),
            "matched_measurable_rca_windows": len(measurable_keys),
            "base_agent_traces_resolved": sum(trace.get("trace_resolved", False) for trace in base_traces),
            "treatment_agent_traces_resolved": sum(
                trace.get("trace_resolved", False) for trace in treatment_traces
            ),
            "base_turn_records": len(base_turns),
            "treatment_turn_records": len(treatment_turns),
        },
        "judge": {
            "base_score": float(metric(base_summary, "score", "deepjudge_score")["mean"]),
            "treatment_score": float(
                metric(treatment_summary, "score", "deepjudge_score")["mean"]
            ),
            "base_immediate_pct": summary_true_percentage(
                base_summary, "deepjudge_immediate_cause_found"
            ),
            "treatment_immediate_pct": summary_true_percentage(
                treatment_summary, "deepjudge_immediate_cause_found"
            ),
        },
        "cost": {
            "base_dollars": float(metric(base_summary, "score", "total_cost_cents")["mean"])
            / 100,
            "treatment_dollars": float(
                metric(treatment_summary, "score", "total_cost_cents")["mean"]
            )
            / 100,
        },
        "experiment_metrics": {
            "base": experiment_summary_stats(base_summary),
            "treatment": experiment_summary_stats(treatment_summary),
        },
        "trace": {
            "base": arm_trace_stats(base_measured),
            "treatment": arm_trace_stats(treatment_measured),
        },
        "turn": {
            "base": arm_turn_stats(base_turns),
            "treatment": arm_turn_stats(treatment_turns),
        },
        "included_pairing_keys": measurable_keys,
    }
    for role in ("base", "treatment"):
        stats = result["trace"][role]
        if abs(stats["total_duration_min"] - stats["llm_min"] - stats["tool_min"]) > 1e-9:
            raise ValueError(f"{role} duration decomposition failed")
    for trace in [*base_measured, *treatment_measured]:
        if any(span["end_ms"] > trace["rca_end_ms"] for span in trace["outer_llms"]):
            raise ValueError(f"post-RCA LLM span entered trace {trace['id']}")
    return result


def unique_values(records: list[dict[str, Any]], key: str) -> list[str]:
    return sorted({str(record[key]) for record in records if record.get(key)})


def main() -> None:
    args = parse_args()
    base_id, treatment_id = parse_comparison_url(args.comparison_url)
    if args.concurrency < 1:
        raise ValueError("concurrency must be positive")
    snapshot_id = args.snapshot_id or datetime.datetime.now(datetime.UTC).strftime("%Y%m%dT%H%M%SZ")
    folders = {
        "base": (args.data_root / base_id / snapshot_id).resolve(),
        "treatment": (args.data_root / treatment_id / snapshot_id).resolve(),
    }
    for folder in folders.values():
        folder.mkdir(parents=True, exist_ok=True)

    log(f"Snapshot ID: {snapshot_id}")
    log(f"Baseline folder: {folders['base']}")
    log(f"Treatment folder: {folders['treatment']}")
    log("Running pre-flight checks")
    preflight_result = preflight(base_id, treatment_id, args.from_time, args.to_time)
    log("Pre-flight passed")
    experiment_ids = {"base": base_id, "treatment": treatment_id}
    records: dict[str, list[dict[str, Any]]] = {}
    references: dict[str, list[dict[str, Any]]] = {}
    traces: dict[str, list[dict[str, Any]]] = {}
    for role in ("base", "treatment"):
        log(f"Collecting {role} experiment {experiment_ids[role]}")
        summary = preflight_result["summaries"][role]
        atomic_json(folders[role] / "summary.json", summary)
        records[role] = collect_events(
            experiment_ids[role], int(summary["total_events"]), folders[role], args.concurrency
        )
        if (folders[role] / "trace-records.jsonl").exists():
            references[role] = []
        else:
            references[role] = collect_root_references(records[role], args.from_time, args.to_time)
        traces[role] = collect_traces(records[role], references[role], folders[role], args.concurrency)
        manifest = {
            "schema_version": 1,
            "collected_at": snapshot_id,
            "input_url": args.comparison_url,
            "role": role,
            "experiment_id": experiment_ids[role],
            "peer_experiment_id": experiment_ids["treatment" if role == "base" else "base"],
            "peer_folder": str(folders["treatment" if role == "base" else "base"]),
            "project_names": unique_values(records[role], "project_name"),
            "project_ids": unique_values(records[role], "project_id"),
            "dataset_ids": unique_values(records[role], "dataset_id"),
            "bits_run_ids": unique_values(records[role], "bits_run_id"),
        }
        atomic_json(folders[role] / "manifest.json", manifest)
        reasons: dict[str, int] = {}
        for trace in traces[role]:
            if not trace.get("trace_complete"):
                reason = trace.get("reason", "unknown")
                reasons[reason] = reasons.get(reason, 0) + 1
        atomic_json(
            folders[role] / "collection-audit.json",
            {
                "scenario_run_records": len(records[role]),
                "unique_result_ids": len({record["id"] for record in records[role]}),
                "agent_traces_resolved": sum(trace.get("trace_resolved", False) for trace in traces[role]),
                "fully_measurable_rca_windows": sum(trace.get("trace_complete", False) for trace in traces[role]),
                "incomplete_reasons": reasons,
                "files": ["manifest.json", "summary.json", "scenario-runs.jsonl", "trace-records.jsonl"],
            },
        )

    persisted_records = {
        role: read_jsonl(folders[role] / "scenario-runs.jsonl") for role in ("base", "treatment")
    }
    persisted_traces = {
        role: read_jsonl(folders[role] / "trace-records.jsonl") for role in ("base", "treatment")
    }
    for role in ("base", "treatment"):
        if len(persisted_records[role]) != len(records[role]):
            raise ValueError(f"{role} persisted scenario count changed")
        if len({record["id"] for record in persisted_records[role]}) != len(records[role]):
            raise ValueError(f"{role} persisted scenario IDs are not unique")
        if len(persisted_traces[role]) != len(records[role]):
            raise ValueError(f"{role} persisted trace count changed")

    persisted_summaries = {
        role: json.loads((folders[role] / "summary.json").read_text(encoding="utf-8"))
        for role in ("base", "treatment")
    }
    result = analyze(
        persisted_summaries["base"],
        persisted_summaries["treatment"],
        persisted_records["base"],
        persisted_records["treatment"],
        persisted_traces["base"],
        persisted_traces["treatment"],
    )
    for role in ("base", "treatment"):
        atomic_json(
            folders[role] / "results.json",
            {
                "role": role,
                "experiment_id": experiment_ids[role],
                "folder": str(folders[role]),
                "counts": result["counts"],
                "judge": result["judge"],
                "cost": result["cost"],
                "experiment_metrics": result["experiment_metrics"][role],
                "trace": result["trace"][role],
                "turn": result["turn"][role],
                "included_pairing_keys": result["included_pairing_keys"],
            },
        )
    result["folders"] = {role: str(folder) for role, folder in folders.items()}
    result["experiment_ids"] = experiment_ids
    result["run_ids"] = {
        role: unique_values(persisted_records[role], "bits_run_id") for role in ("base", "treatment")
    }
    result["dataset_id"] = unique_values(persisted_records["base"], "dataset_id")[0]
    log("Persistence checks and final audits passed")
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, FileNotFoundError, json.JSONDecodeError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from error
