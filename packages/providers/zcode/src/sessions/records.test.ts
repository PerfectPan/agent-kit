import { expect, it } from "vite-plus/test";

import { zcodeMessageOf } from "./records.js";

it("retains completion times without adding cache or reasoning to ZCode totals again", () => {
  expect(
    zcodeMessageOf({
      role: "assistant",
      modelId: "model",
      time: { created: 0, completed: 0 },
      tokens: { input: 17, output: 7, reasoning: 2, cache: { read: 3, write: 4 } }
    })
  ).toMatchObject({
    created: 0,
    completed: 0,
    model: "model",
    usage: { inputTokens: 17, outputTokens: 7 }
  });
});

it.each([undefined, "200", null, NaN, Infinity, -Infinity])("ignores malformed completion time %s", (completed) => {
  expect(zcodeMessageOf({ role: "assistant", time: { created: 100, completed } })).toMatchObject({
    created: 100,
    completed: undefined
  });
});

it("marks messages carrying metadata.forkOrigin as inherited", () => {
  expect(
    zcodeMessageOf({
      role: "assistant",
      time: { created: 100, completed: 200 },
      metadata: { forkOrigin: { sessionId: "ses_parent", messageId: "msg_1" } }
    })?.inherited
  ).toBe(true);
  expect(zcodeMessageOf({ role: "assistant", time: { created: 100, completed: 200 } })?.inherited).toBeUndefined();
});
