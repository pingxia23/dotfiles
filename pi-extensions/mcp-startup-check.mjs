import { spawn } from "node:child_process";

export function runPiCommand(args, { cwd, signal, timeoutMs, onOutput }, spawnImpl = spawn) {
  signal.throwIfAborted();

  return new Promise((resolve, reject) => {
    const child = spawnImpl("pi", args, {
      cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let stopReason;
    let killTimer;

    const killGroup = (killSignal) => {
      if (!child.pid) return;
      try {
        // Stop local MCP servers started by the check as well as the Pi command.
        process.kill(-child.pid, killSignal);
      } catch (error) {
        if (error.code !== "ESRCH") child.kill(killSignal);
      }
    };
    const stop = (reason) => {
      if (stopReason) return;
      stopReason = reason;
      killGroup("SIGTERM");
      killTimer = setTimeout(() => killGroup("SIGKILL"), 1000);
    };
    const abort = () => stop(new Error("Startup check cancelled."));
    const timer = setTimeout(
      () => stop(new Error(`pi ${args.join(" ")} timed out after ${timeoutMs / 1000}s.`)),
      timeoutMs,
    );
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal.removeEventListener("abort", abort);
    };

    signal.addEventListener("abort", abort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      onOutput?.(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      onOutput?.(chunk);
    });
    child.on("error", (error) => {
      cleanup();
      reject(error);
    });
    child.on("close", (code) => {
      if (stopReason) killGroup("SIGKILL");
      cleanup();
      if (stopReason) reject(stopReason);
      else resolve({ code, stdout, stderr });
    });
  });
}

export function createMcpStartupCheck({ run = runPiCommand, argv = process.argv.slice(2) } = {}) {
  return (pi) => {
    let checked = false;
    let controller;
    let running;

    const check = async (ctx, signal) => {
      const notify = (message, level = "info") => {
        if (!signal.aborted && message.trim()) ctx.ui.notify(message.trim(), level);
      };
      try {
        const result = await run(["mcp", "list", "--json"], {
          cwd: ctx.cwd,
          signal,
          timeoutMs: 60_000,
        });
        // Exit code 1 also covers valid reports with servers that need sign-in.
        const report = JSON.parse(result.stdout);
        if (!Array.isArray(report.servers)) throw new Error("Invalid MCP server report.");
        for (const error of report.errors ?? []) notify(error, "warning");

        for (const server of report.servers) {
          if (signal.aborted) return;
          if (!server.enabled) continue;
          if (server.state !== "needs-auth") {
            if (server.state !== "connected") {
              notify(`MCP server ${server.name}: ${server.error || server.state}`, "warning");
            }
            continue;
          }

          notify(`Signing in to MCP server ${server.name}…`);
          try {
            const login = await run(["mcp", "login", server.name, "--timeout", "90"], {
              cwd: ctx.cwd,
              signal,
              timeoutMs: 95_000,
              onOutput: (chunk) => notify(chunk),
            });
            if (login.code !== 0) {
              notify(`Sign-in failed for ${server.name}. Retry with /mcp login ${server.name}.`, "warning");
            }
          } catch (error) {
            notify(`Sign-in failed for ${server.name}: ${error.message}`, "warning");
          }
        }
      } catch (error) {
        notify(`MCP startup check failed: ${error.message}. Run /mcp to inspect servers.`, "warning");
      }
    };

    pi.on("session_start", (_event, ctx) => {
      if (checked || ctx.mode !== "tui" || !ctx.hasUI) return;
      if (argv.some((arg) => ["--no-mcp", "--no-tools", "-nt"].includes(arg))) return;
      checked = true;
      controller = new AbortController();
      // Let Pi render while the check and browser sign-in run.
      running = check(ctx, controller.signal);
    });

    pi.on("session_shutdown", async () => {
      controller?.abort();
      await running;
    });
  };
}

export default createMcpStartupCheck();
