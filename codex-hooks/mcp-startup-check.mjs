#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";

if (process.env.CODEX_MCP_STARTUP_CHECK_ACTIVE === "1") {
  process.exit(0);
}
process.env.CODEX_MCP_STARTUP_CHECK_ACTIVE = "1";

const home = process.env.HOME || os.homedir();
const codexHome = process.env.CODEX_HOME || path.join(home, ".codex");
const configFile =
  process.env.CODEX_MCP_STARTUP_CONFIG || path.join(codexHome, "config.toml");
const credentialsFile =
  process.env.CODEX_MCP_STARTUP_CREDENTIALS ||
  path.join(codexHome, ".credentials.json");
const logFile =
  process.env.CODEX_MCP_STARTUP_LOG ||
  path.join(codexHome, "tmp", "mcp-startup-check.log");
const probeTimeoutMs =
  Number(process.env.CODEX_MCP_STARTUP_PROBE_TIMEOUT || "10") * 1000;
const loginTimeoutMs =
  Number(process.env.CODEX_MCP_STARTUP_LOGIN_TIMEOUT || "90") * 1000;

fs.mkdirSync(path.dirname(logFile), { recursive: true });

function log(message) {
  fs.appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`);
}

function unquoteTomlString(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return trimmed;
}

function readConfigServers() {
  const config = fs.readFileSync(configFile, "utf8");
  const servers = [];
  let current = null;

  for (const rawLine of config.split(/\r?\n/)) {
    const line = rawLine.trim();
    const sectionMatch = line.match(/^\[mcp_servers\.([^\]]+)\]$/);
    if (sectionMatch) {
      current = { name: sectionMatch[1], url: "", enabled: true };
      servers.push(current);
      continue;
    }

    if (line.startsWith("[") && line.endsWith("]")) {
      current = null;
      continue;
    }

    if (!current) {
      continue;
    }

    const keyValueMatch = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!keyValueMatch) {
      continue;
    }

    const [, key, rawValue] = keyValueMatch;
    if (key === "url") {
      current.url = unquoteTomlString(rawValue);
    } else if (key === "enabled" && rawValue.trim() === "false") {
      current.enabled = false;
    }
  }

  return servers.filter((server) => server.enabled && server.url);
}

function readCredentials() {
  try {
    return JSON.parse(fs.readFileSync(credentialsFile, "utf8"));
  } catch (error) {
    log(`credentials unavailable at ${credentialsFile}: ${error.message}`);
    return {};
  }
}

function credentialFor(credentials, server) {
  return Object.values(credentials).find(
    (credential) =>
      credential?.server_name === server.name &&
      credential?.server_url === server.url,
  );
}

function credentialIsExpired(credential) {
  const expiresAt = Number(credential?.expires_at);
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

function hasInitializeResult(text) {
  try {
    return Boolean(JSON.parse(text)?.result?.protocolVersion);
  } catch {
    // Some servers return SSE framing around the JSON-RPC message.
  }

  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) {
      continue;
    }

    try {
      if (JSON.parse(line.slice("data:".length).trim())?.result?.protocolVersion) {
        return true;
      }
    } catch {
      // Keep scanning subsequent SSE lines.
    }
  }

  return /"result"\s*:\s*\{[\s\S]*"protocolVersion"\s*:/.test(text);
}

async function probeServer(server, token) {
  try {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await postJson(
      server.url,
      headers,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: {
            name: "codex-startup-probe",
            version: "1",
          },
        },
      },
    );

    if (
      response.statusCode >= 200 &&
      response.statusCode < 300 &&
      hasInitializeResult(response.body)
    ) {
      log(`${server.name} probe ok`);
      return { ok: true, statusCode: response.statusCode };
    }

    log(`${server.name} probe failed http_status=${response.statusCode}`);
    return { ok: false, statusCode: response.statusCode };
  } catch (error) {
    log(`${server.name} probe failed: ${error.message}`);
    return { ok: false, statusCode: null };
  }
}

function postJson(url, headers, body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === "http:" ? http : https;
    const payload = JSON.stringify(body);
    const request = client.request(
      parsedUrl,
      {
        method: "POST",
        headers: {
          ...headers,
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode || 0,
            body: responseBody,
          });
        });
      },
    );

    request.setTimeout(probeTimeoutMs, () => {
      request.destroy(new Error(`request timed out after ${probeTimeoutMs / 1000}s`));
    });
    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

function runLogin(serverName) {
  return new Promise((resolve) => {
    const loginLog = `${logFile}.${serverName}.login`;
    const output = fs.createWriteStream(loginLog, { flags: "a" });
    let timeout;
    const child = spawn("codex", ["mcp", "login", serverName], {
      env: {
        ...process.env,
        CODEX_MCP_STARTUP_CHECK_ACTIVE: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let finished = false;

    log(`${serverName} starting codex mcp login`);

    const finish = (ok, message) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeout);
      output.end();
      log(message);
      resolve(ok);
    };

    const tee = (chunk) => {
      if (!finished) {
        output.write(chunk);
      }
      process.stderr.write(chunk);
    };

    child.stdout.on("data", tee);
    child.stderr.on("data", tee);
    child.on("error", (error) => {
      finish(false, `${serverName} login spawn failed: ${error.message}`);
    });
    child.on("exit", (code, signal) => {
      if (code === 0) {
        finish(true, `${serverName} login completed`);
      } else {
        finish(
          false,
          `${serverName} login failed code=${code ?? "null"} signal=${
            signal ?? "null"
          }; see ${loginLog}`,
        );
      }
    });

    timeout = setTimeout(() => {
      child.kill();
      process.stderr.write(
        `MCP login for ${serverName} timed out after ${
          loginTimeoutMs / 1000
        }s; see ${loginLog}\n`,
      );
      finish(
        false,
        `${serverName} login timed out after ${loginTimeoutMs / 1000}s; see ${loginLog}`,
      );
    }, loginTimeoutMs);
  });
}

async function main() {
  if (!fs.existsSync(configFile)) {
    log(`skip: config not found at ${configFile}`);
    return;
  }

  const servers = readConfigServers();
  const credentials = readCredentials();

  for (const server of servers) {
    const credential = credentialFor(credentials, server);
    if (!credential?.access_token) {
      const probe = await probeServer(server);
      if (probe.ok) {
        log(`${server.name} reachable without OAuth credential`);
        continue;
      }

      log(`${server.name} missing usable OAuth credential`);
      await runLogin(server.name);
      continue;
    }

    if (credentialIsExpired(credential)) {
      log(`${server.name} OAuth credential expired`);
      await runLogin(server.name);
      continue;
    }

    const probe = await probeServer(server, credential.access_token);
    // A 403 means the token lacks permission; repeating login returns the same scopes.
    if (!probe.ok && probe.statusCode === 401) {
      await runLogin(server.name);
    } else if (!probe.ok) {
      log(
        `${server.name} probe failed with unexpired OAuth credential; skip login`,
      );
    }
  }
}

main().catch((error) => {
  log(`startup check failed: ${error.stack || error.message}`);
});
