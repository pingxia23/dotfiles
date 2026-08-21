import { execFile } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const FALLBACK_MESSAGE = "Pi turn completed.";
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 1_000;

function getAssistantText(message) {
  if (message?.role !== "assistant" || !Array.isArray(message.content)) {
    return "";
  }

  return message.content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

async function getGitBranch(cwd) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"],
      { timeout: 2_000 },
    );
    return stdout.trim() || "N/A";
  } catch {
    return "N/A";
  }
}

async function writeLog(message) {
  const logDir = join(homedir(), ".pi", "agent");
  await mkdir(logDir, { recursive: true });
  await appendFile(
    join(logDir, "notify-hooks.log"),
    `${new Date().toISOString()} ${message}\n`,
  );
}

async function safeWriteLog(log, message) {
  try {
    await log(message);
  } catch {
    // Notification logging must not affect Pi.
  }
}

function buildPayload({ message, branch, cwd, sessionId, leafId }) {
  return {
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `Pi Notification From Branch ${branch}`,
          emoji: true,
        },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: message },
      },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: `*Dir:* ${cwd}` },
          { type: "mrkdwn", text: `*Session:* ${sessionId}` },
          { type: "mrkdwn", text: `*Leaf:* ${leafId}` },
        ],
      },
    ],
  };
}

async function postPayload({ fetchImpl, sleep, webhookUrl, payload }) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetchImpl(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Slack returned HTTP ${response.status}`);
      }

      return;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < MAX_ATTEMPTS) {
      await sleep(RETRY_DELAY_MS);
    }
  }

  throw lastError;
}

export function createSlackNotifyExtension({
  platform = process.platform,
  webhookUrl = process.env.AI_SLACK_WEBHOOK_URL,
  fetchImpl = globalThis.fetch,
  branchResolver = getGitBranch,
  log = writeLog,
  sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
} = {}) {
  return (pi) => {
    if (platform !== "linux" || !webhookUrl) {
      return;
    }

    let hasAssistantMessage = false;
    let latestAssistantText = "";

    pi.on("message_end", (event) => {
      if (event.message?.role !== "assistant") {
        return;
      }

      hasAssistantMessage = true;
      latestAssistantText = getAssistantText(event.message);
    });

    pi.on("agent_settled", async (_event, ctx) => {
      if (!hasAssistantMessage) {
        return;
      }

      const message = latestAssistantText || FALLBACK_MESSAGE;
      hasAssistantMessage = false;
      latestAssistantText = "";

      try {
        const branch = await branchResolver(ctx.cwd);
        const payload = buildPayload({
          message,
          branch,
          cwd: ctx.cwd,
          sessionId: ctx.sessionManager.getSessionId() || "N/A",
          leafId: ctx.sessionManager.getLeafId() || "N/A",
        });

        await postPayload({ fetchImpl, sleep, webhookUrl, payload });
        await safeWriteLog(log, "webhook post succeeded");
      } catch {
        await safeWriteLog(log, "webhook post failed");
      }
    });
  };
}

export default createSlackNotifyExtension();
