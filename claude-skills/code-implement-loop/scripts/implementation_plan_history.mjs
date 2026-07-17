#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HISTORY_FILE_NAME = "committed_plan_history.md";
const PENDING_FILE_NAME = "pending_implementation_plan.md";
const HISTORY_HEADER = "# Committed Implementation Plan History\n";
const PLAN_BODY_MARKER = "\n## Plan\n\n";

function gitText(worktreeRoot, args) {
  const result = spawnSync("git", args, {
    cwd: worktreeRoot,
    encoding: "utf8",
  });
  if (result.error) {
    throw new Error(`git ${args.join(" ")} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed with exit ${result.status}: ${
        result.stderr.trim() || result.stdout.trim() || "no output"
      }`,
    );
  }
  return result.stdout.trim();
}

function writeTextAtomically(filePath, contents) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporaryPath, contents, { flag: "wx" });
  fs.renameSync(temporaryPath, filePath);
}

function readMetadata(contents, name) {
  const match = contents.match(
    new RegExp(`^<!-- code-implement-loop-${name}: (.+) -->$`, "m"),
  );
  if (!match) {
    throw new Error(`pending implementation plan is missing ${name}`);
  }
  return match[1];
}

function parsePendingPlan(contents) {
  const planBodyIndex = contents.indexOf(PLAN_BODY_MARKER);
  if (planBodyIndex < 0) {
    throw new Error("pending implementation plan is missing its plan body");
  }
  return {
    planId: readMetadata(contents, "plan-id"),
    createdAt: readMetadata(contents, "created-at"),
    startHead: readMetadata(contents, "start-head"),
    implementationPlan: contents.slice(planBodyIndex + PLAN_BODY_MARKER.length),
  };
}

export function resolveImplementationPlanDir({ worktreeRoot, branch }) {
  const commonDir = gitText(worktreeRoot, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  const absoluteCommonDir = path.isAbsolute(commonDir)
    ? commonDir
    : path.resolve(worktreeRoot, commonDir);
  return path.join(
    absoluteCommonDir,
    "code-implement-loop",
    "plans",
    encodeURIComponent(branch),
  );
}

export function resolveImplementationPlanPaths({ worktreeRoot, branch }) {
  const implementationPlanDir = resolveImplementationPlanDir({
    worktreeRoot,
    branch,
  });
  return {
    implementation_plan_dir: implementationPlanDir,
    pending_implementation_plan_file: path.join(
      implementationPlanDir,
      PENDING_FILE_NAME,
    ),
    committed_plan_history_file: path.join(
      implementationPlanDir,
      HISTORY_FILE_NAME,
    ),
  };
}

export function deleteImplementationPlan({ worktreeRoot, branch }) {
  const implementationPlanDir = resolveImplementationPlanDir({
    worktreeRoot,
    branch,
  });
  fs.rmSync(implementationPlanDir, { recursive: true, force: true });
  return {
    status: "deleted",
    implementation_plan_dir: implementationPlanDir,
  };
}

export function recordImplementationPlan({
  worktreeRoot,
  branch,
  implementationPlan,
  createdAt = new Date().toISOString(),
  planId = randomUUID(),
}) {
  const paths = resolveImplementationPlanPaths({
    worktreeRoot,
    branch,
  });
  const pendingPlanFile = paths.pending_implementation_plan_file;
  const committedHistoryFile = paths.committed_plan_history_file;
  fs.mkdirSync(paths.implementation_plan_dir, { recursive: true });
  if (!fs.existsSync(committedHistoryFile)) {
    writeTextAtomically(committedHistoryFile, HISTORY_HEADER);
  }

  const pendingPlan = `# Pending Implementation Plan

<!-- code-implement-loop-plan-id: ${planId} -->
<!-- code-implement-loop-created-at: ${createdAt} -->
<!-- code-implement-loop-start-head: ${gitText(worktreeRoot, ["rev-parse", "HEAD"])} -->
${PLAN_BODY_MARKER.slice(1)}${implementationPlan}`;
  writeTextAtomically(pendingPlanFile, pendingPlan);

  return {
    ...paths,
    plan_id: planId,
  };
}

function finalizeImplementationPlanFiles({
  pendingPlanFile,
  committedHistoryFile,
  commitSha,
}) {
  const pendingPlan = parsePendingPlan(
    fs.readFileSync(pendingPlanFile, "utf8"),
  );
  const planMarker = `<!-- code-implement-loop-plan-id: ${pendingPlan.planId} -->`;
  const history = fs.existsSync(committedHistoryFile)
    ? fs.readFileSync(committedHistoryFile, "utf8")
    : HISTORY_HEADER;

  if (!history.includes(planMarker)) {
    const separator = history.endsWith("\n\n")
      ? ""
      : history.endsWith("\n")
        ? "\n"
        : "\n\n";
    const entry = `## Implementation Plan — ${pendingPlan.createdAt}

${planMarker}

- Commit: \`${commitSha}\`
- Starting commit: \`${pendingPlan.startHead}\`

${pendingPlan.implementationPlan}
`;
    writeTextAtomically(committedHistoryFile, `${history}${separator}${entry}`);
  }

  fs.unlinkSync(pendingPlanFile);
  return {
    status: "committed",
    committed_plan_history_file: committedHistoryFile,
    plan_id: pendingPlan.planId,
  };
}

export function finalizeImplementationPlan({ worktreeRoot, branch }) {
  const paths = resolveImplementationPlanPaths({ worktreeRoot, branch });
  return finalizeImplementationPlanFiles({
    pendingPlanFile: paths.pending_implementation_plan_file,
    committedHistoryFile: paths.committed_plan_history_file,
    commitSha: gitText(worktreeRoot, ["rev-parse", "HEAD"]),
  });
}

function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error(`invalid argument: ${name || "<empty>"}`);
    }
    options[name.slice(2)] = value;
  }
  return options;
}

function requireOptions(options, names) {
  for (const name of names) {
    if (!(name in options)) {
      throw new Error(`--${name} is required`);
    }
  }
}

function main() {
  const [command, ...argv] = process.argv.slice(2);
  const options = parseOptions(argv);

  if (command === "committed-history-path") {
    requireOptions(options, ["worktree-root", "branch"]);
    const paths = resolveImplementationPlanPaths({
      worktreeRoot: options["worktree-root"],
      branch: options.branch,
    });
    process.stdout.write(`${paths.committed_plan_history_file}\n`);
    return;
  }

  if (command === "record") {
    requireOptions(options, ["worktree-root", "branch", "implementation-plan"]);
    const result = recordImplementationPlan({
      worktreeRoot: options["worktree-root"],
      branch: options.branch,
      implementationPlan: options["implementation-plan"],
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (command === "finalize") {
    requireOptions(options, ["worktree-root", "branch"]);
    const result = finalizeImplementationPlan({
      worktreeRoot: options["worktree-root"],
      branch: options.branch,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (command === "delete") {
    requireOptions(options, ["worktree-root", "branch"]);
    const result = deleteImplementationPlan({
      worktreeRoot: options["worktree-root"],
      branch: options.branch,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  throw new Error(`unknown command: ${command || "<empty>"}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
