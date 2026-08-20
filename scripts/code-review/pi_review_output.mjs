import fs from "node:fs";

const parameters = JSON.parse(
  fs.readFileSync(
    new URL("./review-output.schema.json", import.meta.url),
    "utf8",
  ),
);

export default function (pi) {
  pi.registerTool({
    name: "submit_review",
    label: "Submit review",
    description: "Submit the final code-review result.",
    parameters,
    async execute(_toolCallId, params) {
      return {
        content: [{ type: "text", text: "Review submitted." }],
        details: params,
        terminate: true,
      };
    },
  });
}
