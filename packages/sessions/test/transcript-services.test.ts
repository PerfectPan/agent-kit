import { expect, it } from "vite-plus/test";

import { baseEvent } from "../src/domain/transcript/factories/transcript-event.js";
import { shadowBefore, shadowedIn } from "../src/domain/transcript/services/compaction-shadowing.js";
import { assignSeq } from "../src/domain/transcript/services/event-ordering.js";
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
