#!/usr/bin/env python3

import argparse
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SOURCE_DIRS = ("raw",)
STATE_FILE = Path("wiki/state.json")


@dataclass(frozen=True)
class SourceFile:
    path: str
    mtime: str
    mtime_epoch: float


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def isoformat_timestamp(timestamp: float) -> str:
    return (
        datetime.fromtimestamp(timestamp, timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def parse_timestamp(value: str | None) -> float | None:
    if value is None:
        return None
    normalized = value.replace("Z", "+00:00")
    return datetime.fromisoformat(normalized).timestamp()


def resolve_vault_root(cli_value: str | None) -> Path:
    if cli_value:
        return Path(cli_value).expanduser().resolve()
    return Path.cwd().resolve()


def state_path_for(vault_root: Path) -> Path:
    return vault_root / STATE_FILE


def load_state(vault_root: Path) -> dict[str, Any]:
    state_path = state_path_for(vault_root)
    if not state_path.exists():
        return {
            "schema_version": 2,
            "last_source_review_at": None,
            "last_successful_run": None,
            "source_inventory": {},
        }
    with state_path.open("r", encoding="utf-8") as handle:
        state = json.load(handle)
    state.setdefault("schema_version", 1)
    state.setdefault("last_source_review_at", None)
    state.setdefault("last_successful_run", None)
    state.setdefault("source_inventory", {})
    return state


def save_state(vault_root: Path, state: dict[str, Any]) -> None:
    state_path = state_path_for(vault_root)
    state_path.parent.mkdir(parents=True, exist_ok=True)
    with state_path.open("w", encoding="utf-8") as handle:
        json.dump(state, handle, indent=2, sort_keys=True)
        handle.write("\n")


def list_source_files(vault_root: Path) -> list[SourceFile]:
    files: list[SourceFile] = []
    for source_dir in SOURCE_DIRS:
        root = vault_root / source_dir
        if not root.exists():
            continue
        for path in sorted(root.rglob("*.md")):
            stat_result = path.stat()
            files.append(
                SourceFile(
                    path=str(path.relative_to(vault_root)),
                    mtime=isoformat_timestamp(stat_result.st_mtime),
                    mtime_epoch=stat_result.st_mtime,
                )
            )
    return sorted(files, key=lambda item: item.path)


def list_changed_files(vault_root: Path, state: dict[str, Any]) -> list[dict[str, Any]]:
    cutoff_timestamp = state.get("last_source_review_at")
    cutoff = parse_timestamp(cutoff_timestamp)
    inventory = state.get("source_inventory") or {}
    last_run = state.get("last_successful_run") or {}
    reviewed_files = set(last_run.get("reviewed_files") or [])
    current_files = list_source_files(vault_root)
    current_paths = {item.path for item in current_files}
    changed: list[dict[str, Any]] = []
    for source_file in current_files:
        known_mtime = inventory.get(source_file.path)
        is_new_since_last_review = source_file.path not in inventory and source_file.path not in reviewed_files
        has_inventory_mismatch = known_mtime is not None and known_mtime != source_file.mtime
        is_newer_than_cutoff = cutoff is None or source_file.mtime_epoch > cutoff
        if is_new_since_last_review or has_inventory_mismatch or is_newer_than_cutoff:
            changed.append(
                {
                    "path": source_file.path,
                    "mtime": source_file.mtime,
                }
            )
    for path in sorted(inventory):
        if path not in current_paths:
            changed.append(
                {
                    "path": path,
                    "deleted": True,
                }
            )
    return changed


def build_status_payload(vault_root: Path) -> dict[str, Any]:
    state = load_state(vault_root)
    changed_files = list_changed_files(vault_root, state)
    return {
        "vault_root": str(vault_root),
        "source_dirs": list(SOURCE_DIRS),
        "source_file_count": len(list_source_files(vault_root)),
        "last_source_review_at": state.get("last_source_review_at"),
        "changed_file_count": len(changed_files),
        "changed_files": changed_files,
        "last_successful_run": state.get("last_successful_run"),
    }


def command_status(args: argparse.Namespace) -> int:
    payload = build_status_payload(resolve_vault_root(args.vault_root))
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0


def command_list_changed(args: argparse.Namespace) -> int:
    vault_root = resolve_vault_root(args.vault_root)
    state = load_state(vault_root)
    payload = {
        "vault_root": str(vault_root),
        "last_source_review_at": state.get("last_source_review_at"),
        "changed_files": list_changed_files(vault_root, state),
    }
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0


def command_record_run(args: argparse.Namespace) -> int:
    vault_root = resolve_vault_root(args.vault_root)
    state = load_state(vault_root)
    completed_at = args.completed_at or utc_now()
    reviewed_files = sorted(
        set(
            args.reviewed_file
            if args.reviewed_file
            else [item["path"] for item in list_changed_files(vault_root, state)]
        )
    )
    state["schema_version"] = 2
    state["last_source_review_at"] = completed_at
    state["source_inventory"] = {item.path: item.mtime for item in list_source_files(vault_root)}
    state["last_successful_run"] = {
        "completed_at": completed_at,
        "mode": args.mode,
        "note": args.note,
        "reviewed_files": reviewed_files,
    }
    save_state(vault_root, state)
    print(json.dumps(state, indent=2, sort_keys=True))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Track timestamp-based wiki source and index review state.")
    parser.add_argument(
        "--vault-root",
        help="Path to the Obsidian vault root. Defaults to the current working directory.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    status_parser = subparsers.add_parser("status", help="Show current review state and changed files.")
    status_parser.set_defaults(func=command_status)

    list_changed_parser = subparsers.add_parser("list-changed", help="List raw files newer than the saved review timestamp.")
    list_changed_parser.set_defaults(func=command_list_changed)

    record_run_parser = subparsers.add_parser("record-run", help="Persist a successful review run timestamp.")
    record_run_parser.add_argument("--mode", default="review", help="Run mode label, for example bootstrap or review.")
    record_run_parser.add_argument("--note", default="", help="Optional note to store with the run.")
    record_run_parser.add_argument(
        "--completed-at",
        help="Override the completion timestamp in UTC ISO 8601 form, for example 2026-04-06T20:35:55Z.",
    )
    record_run_parser.add_argument(
        "--reviewed-file",
        action="append",
        default=[],
        help="Relative source path reviewed during the run. Repeat for multiple files. If omitted, all currently changed files are recorded.",
    )
    record_run_parser.set_defaults(func=command_record_run)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
