import { fileURLToPath } from "node:url";

export const REVIEWER_MODELS = Object.freeze({
  gpt: Object.freeze({
    provider: "openai",
    model: "gpt-5.5",
    thinking: "medium",
    serviceTier: "fast",
  }),
  gemini: Object.freeze({
    provider: "google",
    model: "gemini-3.7-flash",
    thinking: "medium",
  }),
  claude: Object.freeze({
    provider: "ai-gw-anthropic-1m",
    model: "anthropic/claude-opus-4-6",
    thinking: "medium",
  }),
});

const CODE_REVIEW_OUTPUT_EXTENSION_PATH = fileURLToPath(
  new URL("./code-review/pi_review_output.mjs", import.meta.url),
);
const PLAN_REVIEW_OUTPUT_EXTENSION_PATH = fileURLToPath(
  new URL("./plan-review/pi_plan_review_output.mjs", import.meta.url),
);

function piReviewerConfig({
  reviewer,
  promptKind,
  model,
  outputExtensionPath,
  tools,
}) {
  return Object.freeze({
    reviewer,
    promptKind,
    runner: "pi",
    mode: "json",
    ...model,
    extensionPath: outputExtensionPath,
    tools,
  });
}

export const CODE_REVIEW_TIMEOUT_MS = 10 * 60 * 1000;
export const PLAN_REVIEW_TIMEOUT_MS = 5 * 60 * 1000;

export const CODE_REVIEWER_CONFIGS = Object.freeze([
  piReviewerConfig({
    reviewer: "correctness_gpt",
    promptKind: "correctness",
    model: REVIEWER_MODELS.gpt,
    outputExtensionPath: CODE_REVIEW_OUTPUT_EXTENSION_PATH,
    tools: "read,bash,grep,find,ls,submit_review",
  }),
  piReviewerConfig({
    reviewer: "correctness_gemini",
    promptKind: "correctness",
    model: REVIEWER_MODELS.gemini,
    outputExtensionPath: CODE_REVIEW_OUTPUT_EXTENSION_PATH,
    tools: "read,bash,grep,find,ls,submit_review",
  }),
  piReviewerConfig({
    reviewer: "correctness_claude",
    promptKind: "correctness",
    model: REVIEWER_MODELS.claude,
    outputExtensionPath: CODE_REVIEW_OUTPUT_EXTENSION_PATH,
    tools: "read,bash,grep,find,ls,submit_review",
  }),
  piReviewerConfig({
    reviewer: "pythonQuality_gpt",
    promptKind: "pythonQuality",
    model: REVIEWER_MODELS.gpt,
    outputExtensionPath: CODE_REVIEW_OUTPUT_EXTENSION_PATH,
    tools: "read,bash,grep,find,ls,submit_review",
  }),
]);

export const PLAN_REVIEWER_CONFIGS = Object.freeze([
  piReviewerConfig({
    reviewer: "plan_gpt",
    model: REVIEWER_MODELS.gpt,
    outputExtensionPath: PLAN_REVIEW_OUTPUT_EXTENSION_PATH,
    tools: "read,bash,edit,write,grep,find,ls,mcp,submit_plan_review",
  }),
  piReviewerConfig({
    reviewer: "plan_gemini",
    model: REVIEWER_MODELS.gemini,
    outputExtensionPath: PLAN_REVIEW_OUTPUT_EXTENSION_PATH,
    tools: "read,bash,edit,write,grep,find,ls,mcp,submit_plan_review",
  }),
  piReviewerConfig({
    reviewer: "plan_claude",
    model: REVIEWER_MODELS.claude,
    outputExtensionPath: PLAN_REVIEW_OUTPUT_EXTENSION_PATH,
    tools: "read,bash,edit,write,grep,find,ls,mcp,submit_plan_review",
  }),
]);
