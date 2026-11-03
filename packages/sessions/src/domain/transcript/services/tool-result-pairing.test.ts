import { expect, it } from "vite-plus/test";

import { baseEvent } from "../factories/transcript-event.js";
import { markOrphanToolResults } from "./tool-result-pairing.js";

const source = { file: "fixture.jsonl", offset: 0, length: 1, line: 2, value: {} };

it("pairs tool results only with earlier calls on their own lane", () => {
  const call = baseEvent(source, "tool_call", { callId: "c", name: "read" });
  const paired = baseEvent(source, "tool_result", { callId: "c" });
  const child = baseEvent(source, "tool_result", { callId: "c" }, { agentId: "child" });
  const early = baseEvent(source, "tool_result", { callId: "c" });
  markOrphanToolResults([early, call, paired, child]);
  expect([early.payload.orphan, paired.payload.orphan, child.payload.orphan]).toEqual([true, undefined, true]);
});
