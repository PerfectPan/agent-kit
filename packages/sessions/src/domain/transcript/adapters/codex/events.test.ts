import { describe, expect, it } from "vitest";

import { mergeByTime, type StampedRecord } from "../../index.js";
import { translateCodexRecords } from "./events.js";

const session = (result: ReturnType<typeof translateCodexRecords>) => {
  if (!result.ok) {
    throw new Error(`unexpected generation: ${JSON.stringify(result.error)}`);
  }
  return result.value.session;
};

const translated = (result: ReturnType<typeof translateCodexRecords>) => {
  if (!result.ok) {
    throw new Error(`unexpected generation: ${JSON.stringify(result.error)}`);
  }
  return result.value;
};

const at = (ms: number) => new Date(Date.UTC(2026, 0, 1) + ms).toISOString();

/** Records of one rollout, stamped like the adapter stamps them. */
function stamped(values: unknown[]): StampedRecord[] {
  return mergeByTime([
    values.map((value, index) => ({ value, file: "r.jsonl", line: index + 1, offset: index, length: 1 }))
  ]);
}

const count = (ms: number, input: number) => ({
  timestamp: at(ms),
  type: "event_msg",
  payload: { type: "token_count", info: { last_token_usage: { input_tokens: input, output_tokens: 1 } } }
});

describe("translateCodexRecords", () => {
  it("names a session the rollout does not name after its file, else unknown", () => {
    expect(session(translateCodexRecords([], {})).id).toBe("unknown");
    expect(session(translateCodexRecords([], { path: "/r/sessions/2026/01/01/rollout-1.jsonl" })).id).toBe("rollout-1");
    expect(session(translateCodexRecords([], { path: "/r/sessions/.jsonl" })).id).toBe("unknown");
    expect(session(translateCodexRecords([], { sessionId: "from-caller", path: "/r/rollout-1.jsonl" })).id).toBe(
      "from-caller"
    );
  });

  it("reads a field of an unexpected type as absent", () => {
    const transcript = translated(
      translateCodexRecords(
        stamped([
          {
            timestamp: at(0),
            type: "session_meta",
            payload: { id: "cx-leniency", cli_version: 5, cwd: 7, base_instructions: "Be brief." }
          },
          { timestamp: at(1000), type: "turn_context", payload: { model: 5 } },
          {
            timestamp: at(2000),
            type: "token_usage_record",
            payload: { response_id: "r1", usage: "12 tokens" }
          },
          { timestamp: at(3000), type: "event_msg", payload: { type: "task_complete", duration_ms: "slow" } }
        ])
      )
    );
    expect(transcript.session).toEqual({
      id: "cx-leniency",
      startedAt: Date.parse(at(0)),
      endedAt: Date.parse(at(3000))
    });
    expect(transcript.events.map((event) => [event.kind, event.payload])).toEqual([["request", { responseId: "r1" }]]);
    expect(transcript.skipped.map((skip) => skip.reason)).toEqual(["session-meta", "turn-context", "task-marker"]);
  });

  it("reads a payload of an unexpected type as absent, so a bare envelope is not a bare item", () => {
    const transcript = translated(
      translateCodexRecords(
        stamped([
          { timestamp: at(0), type: "session_meta", payload: { id: "cx-leniency" } },
          { timestamp: at(1000), type: "message", payload: 5 },
          { timestamp: at(2000), type: "response_item", payload: 5 },
          { timestamp: at(3000), type: "compaction", payload: null }
        ])
      )
    );
    expect(transcript.events.map((event) => [event.kind, event.payload.type])).toEqual([
      ["unknown", "message"],
      ["unknown", "response_item"],
      ["compaction", undefined]
    ]);
  });

  it("reads a mistyped last_token_usage as no record, so the totals' increase is the usage", () => {
    const transcript = translated(
      translateCodexRecords(
        stamped([
          { timestamp: at(0), type: "session_meta", payload: { id: "cx-last" } },
          {
            timestamp: at(1000),
            type: "event_msg",
            payload: { type: "token_count", info: { total_token_usage: { input_tokens: 100 } } }
          },
          {
            timestamp: at(2000),
            type: "event_msg",
            payload: { type: "token_count", info: { total_token_usage: { input_tokens: 150 }, last_token_usage: 5 } }
          }
        ])
      )
    );
    expect(transcript.events.flatMap((event) => ("usage" in event.payload ? [event.payload.usage] : []))).toEqual([
      { inputTokens: 100 },
      { inputTokens: 50 }
    ]);
  });

  it("compares the totals as they were written: a null or mistyped total never stands in for the last one", () => {
    const usages = (totals: unknown[]) => {
      const transcript = translated(
        translateCodexRecords(
          stamped([
            { timestamp: at(0), type: "session_meta", payload: { id: "cx-totals" } },
            ...totals.map((total, index) => ({
              timestamp: at(1000 + index),
              type: "event_msg",
              payload: { type: "token_count", info: { total_token_usage: total } }
            }))
          ])
        )
      );
      return transcript.events.flatMap((event) => ("usage" in event.payload ? [event.payload.usage] : []));
    };
    expect(usages([{ input_tokens: 100 }, null, null, { input_tokens: 150 }])).toEqual([
      { inputTokens: 100 },
      { inputTokens: 150 }
    ]);
    expect(usages([{ input_tokens: 100 }, 5, { input_tokens: 130 }])).toEqual([
      { inputTokens: 100 },
      { inputTokens: 130 }
    ]);
  });

  it("treats a fork marker of an unexpected type as no fork, so the usage is the rollout's own", () => {
    const meta = (forkedFrom: unknown) => ({
      timestamp: at(0),
      type: "session_meta",
      payload: { id: "cx-fork", forked_from_id: forkedFrom }
    });
    const counts = [count(100, 1), count(200, 2), count(1500, 3)];
    const usage = (input: number) => ({ inputTokens: input, outputTokens: 1, totalTokens: input + 1 });
    const usages = (records: unknown[]) => {
      const result = translated(translateCodexRecords(stamped(records)));
      return result.events.flatMap((event) => ("usage" in event.payload ? [event.payload.usage] : []));
    };
    expect(usages([meta(5), ...counts])).toEqual([usage(1), usage(2), usage(3)]);
    expect(usages([meta("cx-parent"), ...counts])).toEqual([usage(3)]);
  });

  it("fails a record whose envelope names an unknown format generation", () => {
    for (const value of [
      {},
      { timestamp: at(0), type: "session_meta", formatVersion: 9 },
      { type: "" },
      { record_type: "" }
    ]) {
      expect(translateCodexRecords(stamped([value]))).toEqual({
        ok: false,
        error: { _tag: "UnknownFormatGeneration", agent: "codex", file: "r.jsonl", line: 1 }
      });
    }
  });

  it("knows a pre-envelope header by the presence of its id and timestamp, whatever their type", () => {
    const result = translated(translateCodexRecords(stamped([{ id: 5, timestamp: true }])));
    expect(result.skipped.map((skip) => skip.reason)).toEqual(["legacy-header"]);
    expect(result.session.id).toBe("unknown");
    // Presence, not value: a header whose id or timestamp is undefined-valued still names the generation.
    const undefinedValued = translated(translateCodexRecords(stamped([{ id: "cx-undef", timestamp: undefined }])));
    expect(undefinedValued.skipped.map((skip) => skip.reason)).toEqual(["legacy-header"]);
    expect(undefinedValued.session.id).toBe("cx-undef");
  });

  it("reads an empty envelope marker as absent: the header rule decides, and names the session", () => {
    const result = translated(translateCodexRecords(stamped([{ record_type: "", id: "cx-empty", timestamp: at(0) }])));
    expect(result.skipped.map((skip) => skip.reason)).toEqual(["legacy-header"]);
    expect(result.session.id).toBe("cx-empty");
  });

  it("keeps an envelope-less record's own id against a replacement history that names it", () => {
    const result = translated(
      translateCodexRecords(
        stamped([
          { timestamp: at(0), type: "session_meta", payload: { id: "cx-ids" } },
          { timestamp: at(1000), type: "event_msg", id: "E1" },
          {
            timestamp: at(2000),
            type: "response_item",
            payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Keep" }] }
          },
          { timestamp: at(3000), type: "compacted", payload: { message: "s", replacement_history: [{ id: "E1" }] } }
        ])
      )
    );
    const unknown = result.events.find((event) => event.kind === "unknown")!;
    const kept = result.events.find((event) => event.kind === "user")!;
    expect([unknown.id, unknown.shadowedBy]).toEqual(["L2", undefined]);
    expect(kept.shadowedBy).toBe("L4");
  });

  it("links a spawn from the tool result's own output, not the item's other fields", () => {
    const result = translated(
      translateCodexRecords(
        stamped([
          { timestamp: at(0), type: "session_meta", payload: { id: "cx-spawn" } },
          {
            timestamp: at(1000),
            type: "response_item",
            payload: { type: "function_call", name: "spawn_agent", call_id: "c" }
          },
          {
            timestamp: at(2000),
            type: "event_msg",
            payload: {
              type: "item_completed",
              item: { type: "SubAgentActivity", id: "a", agent_thread_id: "th-2", kind: "spawned" }
            }
          },
          {
            timestamp: at(3000),
            type: "response_item",
            payload: {
              type: "tool_search_output",
              call_id: "c",
              tools: [{ type: "namespace" }],
              output: { agent_id: "th-2" }
            }
          }
        ])
      )
    );
    expect(result.agents).toEqual([{ id: "main" }, { id: "th-2", parentId: "main" }]);
  });
});
