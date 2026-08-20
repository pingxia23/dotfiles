import fs from "node:fs";

const parameters = JSON.parse(
  fs.readFileSync(
    new URL("./plan-review-output.schema.json", import.meta.url),
    "utf8",
  ),
);

export default function (pi) {
  pi.registerTool({
    name: "submit_plan_review",
    label: "Submit plan review",
    description: "Submit the final plan-review result.",
    parameters,
    async execute(_toolCallId, params) {
      return {
        content: [{ type: "text", text: "Plan review submitted." }],
        details: params,
        terminate: true,
      };
    },
  });
}
