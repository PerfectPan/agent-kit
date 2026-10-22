import { expect, it } from "vite-plus/test";

import { readField } from "./payload-fields.js";

it("selects non-empty payload paths before own environment values", () => {
  const payload = { get: (path: readonly string[]) => (path[0] === "value" ? "payload" : "") };
  const source = { paths: [["empty"], ["value"]], env: ["DEMO_VALUE"] };
  expect(readField(payload, { DEMO_VALUE: "environment" }, source)).toBe("payload");
  expect(readField(payload, { DEMO_VALUE: "environment" }, { env: ["constructor", "DEMO_VALUE"] })).toBe("environment");
  expect(readField(payload, { DEMO_VALUE: "" }, { env: ["constructor", "DEMO_VALUE"] })).toBeUndefined();
  expect(readField(payload, {}, undefined)).toBeUndefined();
});
