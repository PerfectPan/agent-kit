import { expect, it } from "vite-plus/test";

import { baseEvent } from "../src/domain/transcript/factories/transcript-event.js";
import { shadowBefore, shadowedIn } from "../src/domain/transcript/services/compaction-shadowing.js";
import { assignSeq } from "../src/domain/transcript/services/event-ordering.js";
import {
  latestSnapshot,
  promptSnapshot,
  snapshotHasSystemPrompt,
  snapshotHasTools
} from "../src/domain/transcript/services/prompt-snapshot.js";
import { markOrphanToolResults } from "../src/domain/transcript/services/tool-result-pairing.js";
import { mainAgentId, recordKey } from "../src/domain/transcript/services/turns.js";

const source = { file: "fixture.jsonl", offset: 0, length: 1, line: 2, value: {} };

it("shadows only earlier unshadowed events on the compacted lane, honoring retained input", () => {
  const hidden = baseEvent(source, "user", {}, { id: "hidden" });
  const retained = baseEvent(source, "user", {}, { id: "retained" });
  const child = baseEvent(source, "user", {}, { id: "child", agentId: "child" });
  const prior = { ...baseEvent(source, "user", {}, { id: "prior" }), shadowedBy: "old-compaction" };
  const compact = baseEvent(source, "compaction", {}, { id: "compact" });
  const later = baseEvent(source, "user", {}, { id: "later" });
  const events = [hidden, retained, child, prior, compact, later];
  shadowBefore(events, compact, (event) => event === retained);
  expect(events.map((event) => event.shadowedBy)).toEqual([
    "compact",
    undefined,
    undefined,
    "old-compaction",
    undefined,
    undefined
  ]);
  expect([...shadowedIn(events)]).toEqual(["hidden"]);
  assignSeq(events);
  expect(events.map((event) => event.seq)).toEqual([0, 1, 2, 3, 4, 5]);
  expect(recordKey(hidden)).toBe("fixture.jsonl\u00002");
  expect(mainAgentId({ agents: [{ id: "child", parentId: "root" }, { id: "root" }] })).toBe("root");
});

it("pairs tool results only with earlier calls on their own lane", () => {
  const call = baseEvent(source, "tool_call", { callId: "c", name: "read" });
  const paired = baseEvent(source, "tool_result", { callId: "c" });
  const child = baseEvent(source, "tool_result", { callId: "c" }, { agentId: "child" });
  const early = baseEvent(source, "tool_result", { callId: "c" });
  markOrphanToolResults([early, call, paired, child]);
  expect([early.payload.orphan, paired.payload.orphan, child.payload.orphan]).toEqual([true, undefined, true]);
});

it("selects the last qualifying prompt snapshot and accepts an empty recorded tool list", () => {
  const first = baseEvent(source, "system", { type: "prompt_snapshot", systemPrompt: "first" });
  const tools = baseEvent(source, "system", { type: "prompt_snapshot", tools: [] });
  const last = baseEvent(source, "system", { type: "prompt_snapshot", systemPrompt: "last" });
  const other = baseEvent(source, "system", { type: "other" });
  expect(promptSnapshot(first)).toEqual({ type: "prompt_snapshot", systemPrompt: "first" });
  expect(promptSnapshot(other)).toBeUndefined();
  expect(snapshotHasSystemPrompt(promptSnapshot(tools))).toBe(false);
  expect(snapshotHasTools(promptSnapshot(tools))).toBe(true);
  expect(snapshotHasTools(undefined)).toBe(false);
  expect(latestSnapshot([first, tools, last, other], snapshotHasSystemPrompt)).toBe(last);
  expect(latestSnapshot([first, tools, last, other], snapshotHasTools)).toBe(tools);
  expect(latestSnapshot([other], snapshotHasTools)).toBeUndefined();
});
