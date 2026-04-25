#!/usr/bin/env python3
"""RLM companion utility adapted from drewcsillag/rlm-claude."""

import json
import os
import sys


def cmd_metadata(path):
    stat = os.stat(path)
    with open(path, "rb") as f:
        line_count = sum(1 for _ in f)

    with open(path, "r", errors="replace") as f:
        words = 0
        preview_lines = []
        for i, line in enumerate(f):
            if i < 20:
                preview_lines.append(line.rstrip("\n"))
            words += len(line.split())

    print(json.dumps({
        "path": path,
        "size_bytes": stat.st_size,
        "line_count": line_count,
        "word_count": words,
        "estimated_tokens": words // 3 * 4,
        "preview": preview_lines,
    }, indent=2))


def cmd_chunk(path, start_line, end_line):
    start = int(start_line)
    end = int(end_line)
    with open(path, "r", errors="replace") as f:
        for i, line in enumerate(f, start=1):
            if i < start:
                continue
            if i > end:
                break
            sys.stdout.write(line)


def cmd_assemble(results_dir):
    files = sorted(
        f for f in os.listdir(results_dir)
        if f.endswith(".txt") and f[:-4].isdigit()
    )
    for fname in files:
        with open(os.path.join(results_dir, fname), "r", errors="replace") as f:
            content = f.read()
        sys.stdout.write(content)
        if not content.endswith("\n"):
            sys.stdout.write("\n")


def usage():
    print("Usage:")
    print("  rlm-repl.py metadata <path>")
    print("  rlm-repl.py chunk <path> <start_line> <end_line>")
    print("  rlm-repl.py assemble <results_dir>")
    sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        usage()
    cmd = sys.argv[1]
    if cmd == "metadata" and len(sys.argv) == 3:
        cmd_metadata(sys.argv[2])
    elif cmd == "chunk" and len(sys.argv) == 5:
        cmd_chunk(sys.argv[2], sys.argv[3], sys.argv[4])
    elif cmd == "assemble" and len(sys.argv) == 3:
        cmd_assemble(sys.argv[2])
    else:
        usage()
