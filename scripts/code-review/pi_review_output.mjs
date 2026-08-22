import fs from "node:fs";
import { REVIEWER_MODELS } from "../reviewer_config.mjs";

const parameters = JSON.parse(
  fs.readFileSync(
    new URL("./review-output.schema.json", import.meta.url),
    "utf8",
  ),
);

export default function (pi) {
  pi.on("before_provider_request", (event) => {
    if (event.payload?.model !== REVIEWER_MODELS.gpt.model) {
      return undefined
    }
    return {
      ...event.payload,
      service_tier: REVIEWER_MODELS.gpt.serviceTier,
    };
  });

  pi.registerTool({
    name: "submit_review",
    label: "Submit review",
    description: "Submit the final code-review result.",
    parameters,
    constrainedSampling: { type: "json_schema", strict: "prefer" },
    async execute(_toolCallId, params) {
      return {
        content: [{ type: "text", text: "Review submitted." }],
        details: params,
        terminate: true,
      };
    },
  });
}
