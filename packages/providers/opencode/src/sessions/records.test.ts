import { expect, it } from "vite-plus/test";

import { opencodeMessageOf } from "./records.js";

it("retains completion times alongside OpenCode's cache and reasoning token convention", () => {
  expect(
    opencodeMessageOf({
      role: "assistant",
      time: { created: 0, completed: 0 },
      tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 3, write: 4 } }
    })
  ).toMatchObject({
    created: 0,
    completed: 0,
    usage: { inputTokens: 17, outputTokens: 7 }
  });
});

it.each([undefined, "200", null, NaN, Infinity, -Infinity])("ignores malformed completion time %s", (completed) => {
  expect(opencodeMessageOf({ role: "assistant", time: { created: 100, completed } })).toMatchObject({
    created: 100,
    completed: undefined
  });
});
