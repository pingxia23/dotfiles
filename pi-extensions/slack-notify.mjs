import { execFile } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const FALLBACK_MESSAGE = "Pi turn completed.";
const MAX_ATTEMPTS = 3;
const MAX_SECTION_TEXT_LENGTH = 3_000;
const REQUEST_TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 1_000;
const TRUNCATION_NOTICE = "\n\n_Output truncated to fit Slack._";

function getAssistantOutput(message) {
  if (message?.role !== "assistant" || !Array.isArray(message.content)) {
    return "";
  }

  const text = message.content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n\n");

  if (text) {
    return text;
  }

  // Structured runners can finish with a terminal tool call and no text.
  return message.content
    .filter((block) => block?.type === "toolCall" && block.arguments != null)
    .map((block) => {
      const output =
        typeof block.arguments === "string"
          ? block.arguments.trim()
          : JSON.stringify(block.arguments, null, 2);
      const name = typeof block.name === "string" ? `*${block.name}*\n` : "";
      return output ? `${name}\`\`\`\n${output}\n\`\`\`` : "";
    })
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

function fitSectionText(message) {
  if (message.length <= MAX_SECTION_TEXT_LENGTH) {
    return message;
  }

  return `${message.slice(
    0,
    MAX_SECTION_TEXT_LENGTH - TRUNCATION_NOTICE.length,
  )}${TRUNCATION_NOTICE}`;
}

function buildPayload({ message, branch, cwd, sessionId, model }) {
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
        text: { type: "mrkdwn", text: fitSectionText(message) },
      },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: `*Dir:* ${cwd}` },
          { type: "mrkdwn", text: `*Session:* ${sessionId}` },
          { type: "mrkdwn", text: `*Model:* ${model}` },
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
    let latestAssistantOutput = "";
    let latestModel = "";

    pi.on("message_end", (event) => {
      if (event.message?.role !== "assistant") {
        return;
      }

      hasAssistantMessage = true;
      latestAssistantOutput = getAssistantOutput(event.message);
      latestModel =
        typeof event.message.model === "string" ? event.message.model : "";
    });

    pi.on("agent_settled", async (_event, ctx) => {
      if (!hasAssistantMessage) {
        return;
      }

      const message = latestAssistantOutput || FALLBACK_MESSAGE;
      const model = latestModel || ctx.model?.id || "N/A";
      hasAssistantMessage = false;
      latestAssistantOutput = "";
      latestModel = "";

      try {
        const branch = await branchResolver(ctx.cwd);
        const payload = buildPayload({
          message,
          branch,
          cwd: ctx.cwd,
          sessionId: ctx.sessionManager.getSessionId() || "N/A",
          model,
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
