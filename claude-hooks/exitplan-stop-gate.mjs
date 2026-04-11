#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const TAG = "[exitplan-gate]";
const log = (msg) => process.stderr.write(`${TAG} ${msg}\n`);

// ── 1. Read PreToolUse hook input from stdin ──
let input;
try {
  input = JSON.parse(fs.readFileSync(0, "utf8").trim() || "{}");
} catch {
  log("failed to parse stdin, allowing");
  process.exit(0);
}

log(`input received: tool=${input.tool_name}, session=${input.session_id ?? "unknown"}`);

const transcriptPath = input.transcript_path;
if (!transcriptPath || !fs.existsSync(transcriptPath)) {
  log("no transcript path or file missing, allowing");
  process.exit(0);
}

// ── 2. Extract plan from tool_input (authoritative, no heuristics) ──
// ExitPlanMode's tool_input provides both planFilePath and plan content directly.
const toolInput = input.tool_input || {};
const planFile = toolInput.planFilePath;
const planContent = toolInput.plan;

if (!planFile || !planContent?.trim()) {
  log(`no plan in tool_input (planFilePath=${planFile ?? "missing"}), allowing`);
  process.exit(0);
}

log(`plan file: ${planFile} (${planContent.length} chars)`);

// ── 4. Hash dedup — skip if plan unchanged since last codex review ──
const planHash = crypto.createHash("md5").update(planContent).digest("hex");
const markerFile = `${planFile}.codex-reviewed`;

if (fs.existsSync(markerFile)) {
  const previousHash = fs.readFileSync(markerFile, "utf8").trim();
  if (previousHash === planHash) {
    log("plan unchanged since last review, removing marker and allowing");
    try { fs.unlinkSync(markerFile); } catch {}
    process.exit(0);
  }
}

log(`plan hash: ${planHash}`);

// ── 5. Codex auth check ──
const authResult = spawnSync("codex", ["login", "status"], {
  encoding: "utf8",
  timeout: 15_000,
});

if (authResult.status !== 0) {
  log(`codex auth check failed (exit ${authResult.status}): ${(authResult.stderr || "").trim()}, allowing`);
  process.exit(0);
}

log("codex auth OK");

// ── 6. Build context — extract first user message + last assistant message ──
const transcriptLines = fs.readFileSync(transcriptPath, "utf8").trim().split("\n");
let userRequest = "";
let claudeResponse = "";

for (let i = 0; i < transcriptLines.length; i++) {
  try {
    const entry = JSON.parse(transcriptLines[i]);
    if (entry.type === "human" && entry.message?.content) {
      const text = entry.message.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      if (text.trim()) {
        userRequest = text;
        break;
      }
    }
  } catch {}
}

for (let i = transcriptLines.length - 1; i >= 0; i--) {
  try {
    const entry = JSON.parse(transcriptLines[i]);
    if (entry.type === "assistant" && entry.message?.content) {
      const text = entry.message.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      if (text.trim()) {
        claudeResponse = text;
        break;
      }
    }
  } catch {}
}

// ── 7. Build prompt ──
const prompt = `<task>
Review this implementation plan before it's presented for user approval.
The user's original request and Claude's last response are provided for context.

<user_request>
${userRequest}
</user_request>

<claude_last_response>
${claudeResponse}
</claude_last_response>

<plan>
${planContent}
</plan>
</task>

<compact_output_contract>
Your first line must be exactly one of:
- ALLOW: <short reason>
- BLOCK: <short reason>
Do not put anything before that first line.
</compact_output_contract>

<review_policy>
ALLOW if the plan addresses the user's request and the approach is sound.
BLOCK only for concrete issues: wrong file paths, missed dependencies,
incorrect assumptions about existing code, or a fundamentally flawed approach.
Do NOT block for: style nits, minor improvements, alternative approaches that
are merely different (not better), or missing nice-to-haves.
</review_policy>

<grounding_rules>
Ground every blocking claim in repository files or tool outputs you inspected.
Verify file paths exist and code patterns match before blocking.
</grounding_rules>`;

log(`prompt length: ${prompt.length} chars`);

// ── 8. Run codex ──
const tmpFile = path.join(os.tmpdir(), `exitplan-codex-${Date.now()}.txt`);
log("running codex exec...");

const codexResult = spawnSync("codex", ["exec", "-o", tmpFile, prompt], {
  encoding: "utf8",
  timeout: 15 * 60 * 1000,
});

log(`codex exit code: ${codexResult.status}`);
if (codexResult.stderr) log(`codex stderr: ${codexResult.stderr.trim()}`);

let codexOutput = "";
try {
  codexOutput = fs.readFileSync(tmpFile, "utf8").trim();
  fs.unlinkSync(tmpFile);
} catch (e) {
  log(`failed to read codex output: ${e.message}, allowing`);
  process.exit(0);
}

log(`codex output: ${codexOutput.slice(0, 500)}`);

if (!codexOutput) {
  log("codex produced empty output, allowing");
  process.exit(0);
}

// ── 9. Write hash marker (regardless of ALLOW/BLOCK) ──
try {
  fs.writeFileSync(markerFile, planHash, "utf8");
  log("wrote hash marker");
} catch (e) {
  log(`failed to write hash marker: ${e.message}`);
}

// ── 10. Emit decision ──
const firstLine = codexOutput.split("\n")[0].trim();

if (firstLine.startsWith("BLOCK:")) {
  const reason = `Codex review blocked the plan:\n\n${codexOutput}`;
  log(`decision: BLOCK — ${firstLine}`);
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
}

if (firstLine.startsWith("ALLOW:")) {
  log(`decision: ALLOW — ${firstLine}`);
  process.exit(0);
}

// Unparseable output — fail open
log(`unparseable codex output (first line: ${firstLine}), allowing`);
process.exit(0);
