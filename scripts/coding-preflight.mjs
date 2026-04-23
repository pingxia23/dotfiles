#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function usage() {
  const scriptName = path.basename(process.argv[1] ?? "coding-preflight.mjs");
  console.error(`Usage: ${scriptName}

Resolve shared git/worktree context and enforce the strict coding preflight:
  - must be inside a git worktree
  - must be on a named branch
  - allow local-only branches
  - allow local branch ahead of origin/<branch>
  - block when origin/<branch> is ahead of local HEAD
  - block when unresolved merge conflicts exist
`);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trimEnd();
}

function tryRun(command, args, options = {}) {
  try {
    return {
      ok: true,
      stdout: run(command, args, options),
    };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout?.toString?.() ?? "",
      stderr: error.stderr?.toString?.() ?? "",
      status: error.status ?? 1,
    };
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function emit(key, value) {
  console.log(`${key}=${shellQuote(value)}`);
}

function parseShellAssignments(output) {
  const values = {};
  for (const line of output.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      fail(`Unexpected output from git-context.sh: ${line}`);
    }
    const key = line.slice(0, separatorIndex);
    const rawValue = line.slice(separatorIndex + 1);
    if (!rawValue.startsWith("'") || !rawValue.endsWith("'")) {
      fail(`Unexpected quoted value from git-context.sh: ${line}`);
    }
    const inner = rawValue.slice(1, -1).replace(/'\\''/g, "'");
    values[key] = inner;
  }
  return values;
}

function ensureNoArgs(argv) {
  if (argv.length === 0) {
    return;
  }
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    usage();
    process.exit(0);
  }
  usage();
  process.exit(1);
}

function main() {
  ensureNoArgs(process.argv.slice(2));

  const scriptDir = path.dirname(process.argv[1] ?? ".");
  const gitContextPath = path.join(scriptDir, "git-context.sh");
  const gitContext = tryRun(gitContextPath, []);
  if (!gitContext.ok) {
    const stderr = gitContext.stderr.trim();
    fail(stderr || "git-context.sh failed.");
  }

  const context = parseShellAssignments(gitContext.stdout);
  const branch = context.branch;
  if (!branch) {
    fail("git-context.sh did not return branch.");
  }

  const originBranchRef = `refs/remotes/origin/${branch}`;
  let originBranchExists = "false";
  let localAheadCount = "0";
  let originAheadCount = "0";

  const originBranch = tryRun("git", ["rev-parse", "--verify", "--quiet", originBranchRef]);
  if (originBranch.ok) {
    originBranchExists = "true";
    const counts = run("git", ["rev-list", "--left-right", "--count", `HEAD...${originBranchRef}`]);
    const [leftCount = "0", rightCount = "0"] = counts.trim().split(/\s+/);
    localAheadCount = leftCount;
    originAheadCount = rightCount;

    if (Number(originAheadCount) > 0) {
      fail(
        [
          `Current branch is behind origin/${branch}.`,
          `local_ahead_count=${localAheadCount}`,
          `origin_ahead_count=${originAheadCount}`,
          "Sync or reconcile the branch before running a code-changing workflow.",
        ].join(" ")
      );
    }
  }

  const conflictFiles = run("git", ["diff", "--name-only", "--diff-filter=U"])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (conflictFiles.length > 0) {
    fail(`Unresolved merge conflicts detected: ${conflictFiles.join(", ")}`);
  }

  for (const [key, value] of Object.entries(context)) {
    emit(key, value);
  }
  emit("origin_branch_ref", originBranchRef);
  emit("origin_branch_exists", originBranchExists);
  emit("local_ahead_count", localAheadCount);
  emit("origin_ahead_count", originAheadCount);
}

main();
