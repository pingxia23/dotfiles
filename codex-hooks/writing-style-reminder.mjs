#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const agentsPath = join(homedir(), ".codex", "AGENTS.md");
const lines = readFileSync(agentsPath, "utf8").split(/\r?\n/);
const start = lines.findIndex((line) => line.trimEnd() === "## Writing Style");

if (start === -1) {
  throw new Error(`Could not find the Writing Style section in ${agentsPath}`);
}

const nextSection = lines.findIndex(
  (line, index) => index > start && line.startsWith("## "),
);
const section = lines
  .slice(start, nextSection === -1 ? undefined : nextSection)
  .join("\n")
  .trimEnd();

process.stdout.write(
  `Before drafting the response, apply these instructions:\n\n${section}\n`,
);
