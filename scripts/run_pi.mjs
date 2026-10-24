#!/usr/bin/env node

import { spawn } from "node:child_process";

// Usage: node scripts/run_pi.mjs @/absolute/path/input.md "Request text"
// Pi also accepts piped input. Keep its configured model, tools, and environment.
const child = spawn("pi", ["--print", "--", ...process.argv.slice(2)], {
  stdio: "inherit",
});

const handlers = new Map();
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  const handler = () => child.kill(signal);
  handlers.set(signal, handler);
  process.on(signal, handler);
}

child.on("error", (error) => {
  console.error(`run_pi: ${error.message}`);
  process.exitCode = 1;
});

child.on("close", (code, signal) => {
  for (const [name, handler] of handlers) {
    process.off(name, handler);
  }
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exitCode = code === null || code < 0 ? 1 : code;
  }
});
