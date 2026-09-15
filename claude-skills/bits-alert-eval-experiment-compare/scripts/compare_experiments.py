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
from typing import Any


UUID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
TRACE_ID_PATTERN = re.compile(r'trace_id:"?([^"\s\)]+)')


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
    treatment_experiment_id = match.group(1)
    base_values = query.get("compareTargetExperimentId", [])
    if len(base_values) != 1:
        raise ValueError("compareTargetExperimentId must occur exactly once")
    base_experiment_id = base_values[0]
    if not UUID_PATTERN.fullmatch(base_experiment_id) or not UUID_PATTERN.fullmatch(
        treatment_experiment_id
    ):
        raise ValueError("both experiment IDs must be UUIDs")
    return base_experiment_id, treatment_experiment_id


def parse_json_output(stdout: str) -> Any:
    stripped = stdout.strip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        starts = [
            index for index in (stripped.find("{"), stripped.find("[")) if index >= 0
        ]
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
            raise RuntimeError(
                "pup authentication failed; run `pup auth login` and retry"
            )
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


def list_events(experiment_id: str, expected_count: int) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    while len(events) < expected_count:
        page = pup(
            [
                "experiments",
                "events",
                "list",
                experiment_id,
                "--limit",
                "20",
                "--offset",
                str(len(events)),
            ]
        )
        batch = page.get("events", [])
        if not batch:
            break
        events.extend(batch)
    if len(events) != expected_count:
        raise ValueError(f"listed {len(events)} events, expected {expected_count}")
    return events


def trace_reference(
    event: dict[str, Any], from_time: str, to_time: str
) -> dict[str, str] | None:
    link = event.get("output", {}).get("links", {}).get("agent_llmobs_trace_url")
    if not link:
        return None
    parameters = urllib.parse.parse_qs(urllib.parse.urlparse(link).query)
    query = parameters.get("query", [""])[-1]
    match = TRACE_ID_PATTERN.search(query)
    if not match:
        return None
    return {
        "trace_id": match.group(1),
        "from": parameters.get("start", parameters.get("from_ts", [from_time]))[-1],
        "to": parameters.get("end", parameters.get("to_ts", [to_time]))[-1],
        "url": link,
    }


def walk_tree(node: dict[str, Any]) -> list[dict[str, Any]]:
    nodes = [node]
    for child in node.get("children", []):
        nodes.extend(walk_tree(child))
    return nodes


def agent_loop_candidates(trace: dict[str, Any]) -> list[dict[str, Any]]:
    candidates = []
    for node in walk_tree(trace["root_span"]):
        if node.get("kind") != "agent":
            continue
        direct_llms = sum(
            child.get("kind") == "llm" for child in node.get("children", [])
        )
        if direct_llms:
            candidates.append(
                {
                    "span_id": str(node["span_id"]),
                    "name": node.get("name"),
                    "direct_llms": direct_llms,
                    "duration_ms": node.get("duration_ms"),
                }
            )
    return sorted(candidates, key=lambda item: (-item["direct_llms"], item["span_id"]))


def download_span_details(
    reference: dict[str, str], span_ids: list[str]
) -> list[dict[str, Any]]:
    batches = []
    for index in range(0, len(span_ids), 20):
        batches.append(
            pup(
                [
                    "spans",
                    "get-details",
                    "--trace-id",
                    reference["trace_id"],
                    "--span-ids",
                    ",".join(span_ids[index : index + 20]),
                    "--from",
                    reference["from"],
                    "--to",
                    reference["to"],
                ]
            )
        )
    return batches


def parallel_map(
    items: list[Any], function: Any, concurrency: int, label: str
) -> list[Any]:
    results: list[Any] = [None] * len(items)
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = {
            executor.submit(function, item): index for index, item in enumerate(items)
        }
        for completed, future in enumerate(
            concurrent.futures.as_completed(futures), start=1
        ):
            results[futures[future]] = future.result()
            if completed % 50 == 0 or completed == len(items):
                log(f"{label}: {completed}/{len(items)}")
    return results


def download_event(experiment_id: str, event_id: str, folder: Path) -> dict[str, Any]:
    path = folder / "events" / f"{event_id}.json"
    if path.exists():
        with path.open(encoding="utf-8") as source:
            return json.load(source)
    event = pup(["experiments", "events", "get", experiment_id, event_id])
    atomic_json(path, event)
    return event


def download_trace_and_turns(
    event: dict[str, Any],
    folder: Path,
    from_time: str,
    to_time: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    event_id = str(event["id"])
    trace_path = folder / "traces" / f"{event_id}.json"
    turns_path = folder / "turns" / f"{event_id}.json"
    trace_record = None
    turn_record = None
    if trace_path.exists():
        with trace_path.open(encoding="utf-8") as source:
            trace_record = json.load(source)
    if turns_path.exists():
        with turns_path.open(encoding="utf-8") as source:
            turn_record = json.load(source)
    if trace_record and turn_record and "llm_span_detail_batches" in trace_record:
        return trace_record, turn_record

    reference = (trace_record or {}).get("reference") or trace_reference(
        event, from_time, to_time
    )
    if reference is None:
        trace_record = {"event_id": event_id, "state": "missing_agent_trace_link"}
        turn_record = {"event_id": event_id, "state": "missing_agent_trace_link"}
        atomic_json(trace_path, trace_record)
        atomic_json(turns_path, turn_record)
        return trace_record, turn_record

    if trace_record and trace_record.get("state") == "downloaded":
        trace = trace_record["trace"]
    else:
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
    root_span_id = str(trace["root_span"]["span_id"])
    root_span_details = (trace_record or {}).get(
        "root_span_details"
    ) or download_span_details(reference, [root_span_id])[0]
    llm_span_ids = [
        str(node["span_id"])
        for node in walk_tree(trace["root_span"])
        if node.get("kind") == "llm"
    ]
    llm_span_detail_batches = download_span_details(reference, llm_span_ids)
    trace_record = {
        "event_id": event_id,
        "state": "downloaded",
        "reference": reference,
        "trace": trace,
        "root_span_details": root_span_details,
        "llm_span_detail_batches": llm_span_detail_batches,
    }
    atomic_json(trace_path, trace_record)

    if turn_record is not None:
        return trace_record, turn_record

    attempts = []
    selected_loop = None
    for candidate in agent_loop_candidates(trace):
        loop = pup(
            [
                "spans",
                "get-agent-loop",
                "--trace-id",
                reference["trace_id"],
                "--span-id",
                candidate["span_id"],
                "--from",
                reference["from"],
                "--to",
                reference["to"],
                "--max-content-length",
                "0",
            ]
        )
        attempts.append({"candidate": candidate, "agent_loop": loop})
        if loop.get("iterations"):
            selected_loop = loop
            break
    turn_record = {
        "event_id": event_id,
        "state": "downloaded" if selected_loop else "no_agent_loop_iterations",
        "trace_id": reference["trace_id"],
        "agent_loop": selected_loop,
        "attempts": attempts,
    }
    atomic_json(turns_path, turn_record)
    return trace_record, turn_record


def collect_arm(
    role: str,
    experiment_id: str,
    folder: Path,
    concurrency: int,
    from_time: str,
    to_time: str,
) -> dict[str, Any]:
    log(f"Downloading {role} experiment {experiment_id}")
    summary = pup(["experiments", "summary", experiment_id])
    atomic_json(folder / "summary.json", summary)

    listed = list_events(experiment_id, int(summary["total_events"]))
    event_ids = list(dict.fromkeys(str(event["id"]) for event in listed))
    log(f"Downloading {len(event_ids)} full events")
    events = parallel_map(
        event_ids,
        lambda event_id: download_event(experiment_id, event_id, folder),
        concurrency,
        "Events downloaded",
    )
    atomic_jsonl(folder / "events.jsonl", events)

    log(f"Downloading {len(events)} traces and agent-loop records")
    downloaded = parallel_map(
        events,
        lambda event: download_trace_and_turns(event, folder, from_time, to_time),
        concurrency,
        "Trace records downloaded",
    )
    trace_records = [item[0] for item in downloaded]
    turn_records = [item[1] for item in downloaded]
    atomic_jsonl(folder / "traces.jsonl", trace_records)
    atomic_jsonl(folder / "turns.jsonl", turn_records)

    manifest = {
        "role": role,
        "experiment_id": experiment_id,
        "folder": str(folder),
        "event_records": len(events),
        "trace_records": len(trace_records),
        "turn_records": len(turn_records),
        "files": ["summary.json", "events.jsonl", "traces.jsonl", "turns.jsonl"],
    }
    atomic_json(folder / "manifest.json", manifest)
    return manifest


def main() -> None:
    args = parse_args()
    if args.concurrency < 1:
        raise ValueError("concurrency must be positive")
    base_experiment_id, treatment_experiment_id = parse_comparison_url(
        args.comparison_url
    )
    snapshot_id = args.snapshot_id or datetime.datetime.now(datetime.UTC).strftime(
        "%Y%m%dT%H%M%SZ"
    )
    folders = {
        "base": (args.data_root / base_experiment_id / snapshot_id).resolve(),
        "treatment": (args.data_root / treatment_experiment_id / snapshot_id).resolve(),
    }
    for folder in folders.values():
        folder.mkdir(parents=True, exist_ok=True)
    log(f"Snapshot ID: {snapshot_id}")
    log(f"Baseline folder: {folders['base']}")
    log(f"Treatment folder: {folders['treatment']}")

    manifests = {
        "base": collect_arm(
            "base",
            base_experiment_id,
            folders["base"],
            args.concurrency,
            args.from_time,
            args.to_time,
        ),
        "treatment": collect_arm(
            "treatment",
            treatment_experiment_id,
            folders["treatment"],
            args.concurrency,
            args.from_time,
            args.to_time,
        ),
    }
    print(
        json.dumps(
            {
                "snapshot_id": snapshot_id,
                "base_experiment_id": base_experiment_id,
                "treatment_experiment_id": treatment_experiment_id,
                "base_folder": str(folders["base"]),
                "treatment_folder": str(folders["treatment"]),
                "manifests": manifests,
            },
            indent=2,
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, FileNotFoundError, json.JSONDecodeError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from error
