import { describe, expect, it } from "vite-plus/test";

import { foldTranscript } from "../services/fold-transcript.js";
import type { TranscriptEvent, TranscriptEventKind, TranscriptEventOf } from "./transcript-event.js";
import type { TranscriptSnapshot } from "./transcript-snapshot.js";
import { restoreTranscript } from "./transcript.js";

/** An event's fields; the payload may be left out, as `{}`, for the kinds whose payload fields are all optional. */
type EventInput = {
  [K in TranscriptEventKind]: Partial<TranscriptEventOf<K>> &
    Pick<TranscriptEventOf<K>, "id" | "kind" | ({} extends TranscriptEventOf<K>["payload"] ? never : "payload")>;
}[TranscriptEventKind];

/** An event of its own record: the line is the event's position, so prompt records never merge. */
function event(partial: EventInput, line: number): TranscriptEvent {
  return { seq: 0, ts: 1, payload: {}, source: { file: "fixture.jsonl", offset: 0, length: 1, line }, ...partial };
}

function snapshot(partial: Partial<TranscriptSnapshot> = {}): TranscriptSnapshot {
  return {
    agent: "demo",
    session: { id: "s" },
    capabilities: ["requests", "usage"],
    agents: [{ id: "root" }, { id: "child", parentId: "root" }],
    events: [
      event({ id: "first", kind: "user", payload: { text: "first prompt" } }, 1),
      event({ id: "call", kind: "request", payload: { usage: { inputTokens: 3, outputTokens: 1 } } }, 2),
      event({ id: "compact", kind: "compaction", payload: {} }, 3),
      event({ id: "second", kind: "user", payload: { text: "second prompt" } }, 4),
      event({ id: "sub", kind: "user", agentId: "child", payload: { text: "subagent prompt" } }, 5)
    ],
    skipped: [],
    ...partial
  };
}

describe("restoreTranscript", () => {
  it("summarizes by the fold rules, behind the capabilities the transcript lists", () => {
    expect(restoreTranscript(snapshot()).summarize()).toEqual({
      turns: 2,
      requests: 1,
      inputTokens: 3,
      outputTokens: 1,
      failedTools: 0,
      contextShape: [3]
    });
    expect(restoreTranscript(snapshot({ capabilities: ["requests"] })).summarize()).toEqual({
      turns: 2,
      requests: 1,
      failedTools: 0
    });
  });

  it("collects the main lane's prompts under the caps", () => {
    const model = restoreTranscript(snapshot());
    expect(model.prompts({ limit: 1, maxChars: 5 })).toEqual([{ text: "first" }]);
    expect(model.prompts({ limit: 5, maxChars: 100 })).toEqual([{ text: "first prompt" }, { text: "second prompt" }]);
  });

  it("names the root lane, else main", () => {
    expect(restoreTranscript(snapshot()).mainAgentId()).toBe("root");
    expect(restoreTranscript(snapshot({ agents: [] })).mainAgentId()).toBe("main");
  });

  it("lists the prompt starts on one lane or on all", () => {
    const model = restoreTranscript(snapshot());
    expect(model.promptStarts().map((start) => start.id)).toEqual(["first", "second", "sub"]);
    expect(model.promptStarts("root").map((start) => start.id)).toEqual(["first", "second"]);
    expect(model.promptStarts("child").map((start) => start.id)).toEqual(["sub"]);
  });

  it("lists the events a compaction in the transcript replaced", () => {
    const events = snapshot().events.map((item) => (item.id === "first" ? { ...item, shadowedBy: "compact" } : item));
    expect(restoreTranscript(snapshot({ events })).shadowed()).toEqual(new Set(["first"]));
  });

  it("returns its snapshot and shares the snapshot's arrays", () => {
    const plain = snapshot();
    const model = restoreTranscript(plain);
    expect(model.toSnapshot()).toBe(plain);
    expect(model.events).toBe(plain.events);
    expect(model.agents).toBe(plain.agents);
    expect(model.capabilities).toBe(plain.capabilities);
    expect(model.skipped).toBe(plain.skipped);
  });

  it("crosses a boundary as its snapshot", () => {
    const plain = snapshot();
    const model = restoreTranscript(plain);
    expect(JSON.stringify(model)).toBe(JSON.stringify(plain));
    const clone: unknown = structuredClone(model);
    expect(Object.keys(clone as object)).toEqual(Object.keys(plain));
    expect(Object.values(clone as object).some((field) => typeof field === "function")).toBe(false);
    expect(Object.hasOwn(clone as object, "agentVersion")).toBe(false);
    expect(restoreTranscript(clone as TranscriptSnapshot).summarize()).toEqual(model.summarize());
  });

  it("keeps the agent version a snapshot records", () => {
    expect(restoreTranscript(snapshot({ agentVersion: "2.0.0" })).agentVersion).toBe("2.0.0");
  });

  it("is frozen", () => {
    const model = restoreTranscript(snapshot());
    expect(Object.isFrozen(model)).toBe(true);
    expect(() => {
      (model as { agent: string }).agent = "other";
    }).toThrow(TypeError);
  });

  it("is accepted where a snapshot is", () => {
    const model = restoreTranscript(snapshot());
    expect(foldTranscript(model)).toEqual(model.summarize());
  });
});
