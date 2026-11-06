import { expect, it } from "vite-plus/test";

import { baseEvent } from "../factories/transcript-event.js";
import { latestSnapshot, promptSnapshot, snapshotHasSystemPrompt, snapshotHasTools } from "./prompt-snapshot.js";

const source = { file: "fixture.jsonl", offset: 0, length: 1, line: 2, value: {} };

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
