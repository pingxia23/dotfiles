import fs from "node:fs";
import { REVIEWER_MODELS } from "../reviewer_config.mjs";

const parameters = JSON.parse(
  fs.readFileSync(
    new URL("./plan-review-output.schema.json", import.meta.url),
    "utf8",
  ),
);

export default function (pi) {
  pi.on("before_provider_request", (event) => {
    if (event.payload?.model !== REVIEWER_MODELS.gpt.model) {
      return undefined;
    }
    return {
      ...event.payload,
      service_tier: REVIEWER_MODELS.gpt.serviceTier,
    };
  });

  pi.registerTool({
    name: "submit_plan_review",
    label: "Submit plan review",
    description: "Submit the final plan-review result.",
    parameters,
    constrainedSampling: { type: "json_schema", strict: "prefer" },
    async execute(_toolCallId, params) {
      return {
        content: [{ type: "text", text: "Plan review submitted." }],
        details: params,
        terminate: true,
      };
    },
  });
}
