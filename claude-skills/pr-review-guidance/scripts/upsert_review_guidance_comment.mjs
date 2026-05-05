#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const MARKER = "<!-- ping-xia-pr-review-guidance:v1 -->";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function usage() {
  fail(
    `Usage: ${path.basename(process.argv[1] ?? "upsert_review_guidance_comment.mjs")} <pr-url> [body|-]`,
  );
}

function readBody(argv) {
  if (argv.length === 2 && argv[1] !== "-") {
    return argv[1];
  }
  return readFileSync(0, "utf8");
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 1 || args.length > 2) {
    usage();
  }

  const body = readBody(args);
  const sharedScript = path.join(
    homedir(),
    "dotfiles",
    "scripts",
    "upsert_pr_comment.mjs",
  );
  const result = spawnSync(
    process.execPath,
    [sharedScript, "--pr-url", args[0], "--marker", MARKER, "--body", body],
    {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  if (result.error) {
    fail(result.error.message);
  }
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }
  process.stdout.write(result.stdout);
}

main();
