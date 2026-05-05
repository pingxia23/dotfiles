#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const MARKER = "<!-- ping-xia-pr-review-summary:v1 -->";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function usage() {
  fail(
    `Usage: ${path.basename(process.argv[1] ?? "upsert_review_summary_comment.mjs")} --pr-url <url> --review-file <file>`,
  );
}

function runSharedUpsert(prUrl, body) {
  const sharedScript = path.join(
    homedir(),
    "dotfiles",
    "scripts",
    "upsert_pr_comment.mjs",
  );
  try {
    return execFileSync(
      process.execPath,
      [sharedScript, "--pr-url", prUrl, "--marker", MARKER, "--body", body],
      {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
  } catch (error) {
    const stderr = error.stderr?.toString?.() ?? "";
    const stdout = error.stdout?.toString?.() ?? "";
    fail(stderr || stdout || error.message);
  }
}

function parseArgs(argv) {
  const args = {
    prUrl: "",
    reviewFile: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];

    if (arg === "--pr-url") {
      args.prUrl = value ?? "";
      index += 1;
    } else if (arg === "--review-file") {
      args.reviewFile = value ?? "";
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      usage();
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }

  if (!args.prUrl || !args.reviewFile) {
    usage();
  }

  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.reviewFile)) {
    fail(`Review file does not exist: ${args.reviewFile}`);
  }
  if (
    !statSync(args.reviewFile).isFile() ||
    statSync(args.reviewFile).size === 0
  ) {
    fail(`Review file must not be empty: ${args.reviewFile}`);
  }

  const reviewBody = readFileSync(args.reviewFile, "utf8");
  if (!reviewBody.trim()) {
    fail(`Review file must not be empty: ${args.reviewFile}`);
  }

  const body = `${MARKER}\n\n${reviewBody}`;
  process.stdout.write(runSharedUpsert(args.prUrl, body));
}

main();
