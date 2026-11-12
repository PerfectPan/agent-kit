import { describe, expect, it } from "vite-plus/test";

import type { Result } from "@rivus/agent-kit-catalog/public";
import { translateGrokRecords } from "./events.js";

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) {
    throw new Error(`unexpected failure: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function grokRecord(update: Record<string, unknown>, line: number) {
  return {
    value: { timestamp: "2026-01-01T00:00:00.000Z", params: { update } },
    file: "updates.jsonl",
    line,
    offset: 0,
    length: 1
  };
}

describe("grok translation", () => {
  it("returns an unknown generation from the pure translation", () => {
    const value = {
      timestamp: "2026-01-01T00:00:00.000Z",
      params: { update: { sessionUpdate: "user_message_chunk", schema_version: 4 } }
    };
    expect(translateGrokRecords([{ value, file: "updates.jsonl", line: 1, offset: 0, length: 1 }])).toEqual({
      ok: false,
      error: { _tag: "UnknownFormatGeneration", agent: "grok", file: "updates.jsonl", line: 1 }
    });
  });

  it("keeps tool arguments and output when a later update carries only status", () => {
    const parsed = value(
      translateGrokRecords([
        grokRecord({ sessionUpdate: "tool_call", toolCallId: "call-1", title: "shell", status: "pending" }, 1),
        grokRecord(
          {
            sessionUpdate: "tool_call_update",
            toolCallId: "call-1",
            status: "in_progress",
            rawInput: { command: "npm test" },
            content: [{ type: "content", content: { type: "text", text: "1 failed" } }]
          },
          2
        ),
        grokRecord({ sessionUpdate: "tool_call_update", toolCallId: "call-1", status: "completed" }, 3)
      ])
    );
    const calls = parsed.events.filter((event) => event.kind === "tool_call");
    const results = parsed.events.filter((event) => event.kind === "tool_result");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.payload.args).toEqual({ command: "npm test" });
    expect(results).toHaveLength(1);
    expect(results[0]?.payload.output).toBe("1 failed");
    expect(results[0]?.payload.isError).toBe(false);
    expect(parsed.skipped.map((skip) => skip.reason)).toEqual(["tool-progress"]);
  });

  it("leaves prior context in place when compaction starts and never completes", () => {
    const parsed = value(
      translateGrokRecords([
        grokRecord(
          {
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text: "Keep me" },
            _meta: { promptIndex: 0 }
          },
          1
        ),
        grokRecord({ sessionUpdate: "auto_compact_started", tokens_used: 500 }, 2)
      ])
    );
    expect(parsed.events.find((event) => event.kind === "user")?.shadowedBy).toBeUndefined();
    expect(parsed.events.some((event) => event.kind === "compaction")).toBe(false);
    expect(parsed.skipped.map((skip) => skip.reason)).toEqual(["compact-started"]);
  });

  it("takes the request model from this turn's usage when the turn names no model id", () => {
    const parsed = value(
      translateGrokRecords([
        grokRecord(
          {
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text: "First" },
            _meta: { modelId: "grok-old", promptIndex: 0 }
          },
          1
        ),
        grokRecord(
          {
            sessionUpdate: "turn_completed",
            usage: { inputTokens: 1, outputTokens: 1, modelUsage: { "grok-old": { inputTokens: 1, outputTokens: 1 } } }
          },
          2
        ),
        grokRecord(
          {
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text: "Second" },
            _meta: { promptIndex: 1 }
          },
          3
        ),
        grokRecord(
          {
            sessionUpdate: "turn_completed",
            usage: {
              inputTokens: 20,
              outputTokens: 2,
              modelUsage: { "grok-new": { inputTokens: 20, outputTokens: 2 } }
            }
          },
          4
        )
      ])
    );
    const requests = parsed.events.filter((event) => event.kind === "request");
    expect(requests[0]?.payload.model).toBe("grok-old");
    expect(requests[1]?.payload.model).toBe("grok-new");
    expect(requests[1]?.payload.usage).toEqual({ inputTokens: 20, outputTokens: 2, totalTokens: 22 });
    expect(requests[1]?.payload.usageByModel).toEqual({
      "grok-new": { usage: { inputTokens: 20, outputTokens: 2, totalTokens: 22 } }
    });
  });

  it("maps hook fields and takes the first failing run's exit code", () => {
    const parsed = value(
      translateGrokRecords([
        grokRecord(
          {
            sessionUpdate: "hook_execution",
            event_name: "PostToolUse",
            tool_name: "shell",
            runs: [
              { name: "prepare", status: { status: "success" } },
              { name: "format", exit_code: 0, status: { status: "success", exit_code: 9 } },
              { name: "lint", status: { status: "error", exit_code: 3 } },
              { name: "test", exit_code: 7, status: { status: "error", exit_code: 11 } }
            ]
          },
          1
        )
      ])
    );
    expect(parsed.events.find((event) => event.kind === "hook")?.payload).toEqual({
      type: "hook_execution",
      event: "PostToolUse",
      name: "shell",
      exitCode: 3,
      runs: [
        { name: "prepare", status: "success" },
        { name: "format", status: "success", exitCode: 0 },
        { name: "lint", status: "error", exitCode: 3 },
        { name: "test", status: "error", exitCode: 7 }
      ]
    });
  });

  it("sets a hook's exit code to zero when every run reports zero", () => {
    const parsed = value(
      translateGrokRecords([
        grokRecord(
          {
            sessionUpdate: "hook_execution",
            event_name: "PostToolUse",
            tool_name: "shell",
            runs: [
              { name: "format", exit_code: 0 },
              { name: "lint", status: { exit_code: 0 } }
            ]
          },
          1
        )
      ])
    );
    expect(parsed.events.find((event) => event.kind === "hook")?.payload).toEqual({
      type: "hook_execution",
      event: "PostToolUse",
      name: "shell",
      exitCode: 0,
      runs: [
        { name: "format", exitCode: 0 },
        { name: "lint", exitCode: 0 }
      ]
    });
  });

  it.each([
    {
      scenario: "one run has no numeric code",
      update: { runs: [{ exit_code: 0 }, { status: { status: "success" } }] }
    },
    { scenario: "a code is a string", update: { runs: [{ exit_code: "0", status: { status: "success" } }] } },
    { scenario: "the runs are empty", update: { runs: [] } },
    { scenario: "one run is malformed", update: { runs: [{ exit_code: 0 }, null] } },
    { scenario: "the runs field is malformed", update: { runs: "invalid" } },
    { scenario: "the runs field is absent", update: {} }
  ])("omits a hook's exit code when $scenario", ({ update }) => {
    const parsed = value(translateGrokRecords([grokRecord({ sessionUpdate: "hook_execution", ...update }, 1)]));
    const payload = parsed.events.find((event) => event.kind === "hook")?.payload;
    expect(payload).toBeDefined();
    expect(payload).not.toHaveProperty("exitCode");
  });

  it("keeps the full hook output in the normalized payload", () => {
    const output = `${"x".repeat(305)}DIAGNOSTIC`;
    const parsed = value(
      translateGrokRecords([
        grokRecord(
          {
            sessionUpdate: "hook_execution",
            event_name: "PostToolUse",
            runs: [{ name: "lint", output, status: { status: "success" } }]
          },
          1
        )
      ])
    );
    const runs = parsed.events.find((event) => event.kind === "hook")?.payload.runs;
    expect(output).toHaveLength(315);
    expect(runs).toEqual([{ name: "lint", status: "success", output }]);
  });

  it("merges an empty-object rawInput into the previous args, replaces outputs with empty values, and keeps them when the field is null", () => {
    const call = (id: string, line: number) =>
      grokRecord(
        { sessionUpdate: "tool_call", toolCallId: id, title: "shell", rawInput: { command: "npm test" } },
        line
      );
    const done = (id: string, line: number, extra: Record<string, unknown>) =>
      grokRecord({ sessionUpdate: "tool_call_update", toolCallId: id, status: "completed", ...extra }, line);
    const parsed = value(
      translateGrokRecords([
        call("empty-string", 1),
        done("empty-string", 2, { rawOutput: "temporary" }),
        done("empty-string", 3, { rawInput: {}, rawOutput: "" }),
        call("empty-content", 4),
        done("empty-content", 5, { content: [{ type: "content", content: { type: "text", text: "temporary" } }] }),
        done("empty-content", 6, { content: "" }),
        call("empty-array", 7),
        done("empty-array", 8, { rawOutput: "temporary" }),
        done("empty-array", 9, { rawOutput: [] }),
        call("empty-object", 10),
        done("empty-object", 11, { rawOutput: "temporary" }),
        done("empty-object", 12, { rawOutput: {} }),
        call("keep-null", 13),
        done("keep-null", 14, { rawOutput: "temporary" }),
        done("keep-null", 15, { rawInput: null, rawOutput: null, content: null })
      ])
    );
    const argsOf = (id: string) =>
      parsed.events.find((event) => event.kind === "tool_call" && event.payload.callId === id)?.payload.args;
    const outputOf = (id: string) =>
      parsed.events.find((event) => event.kind === "tool_result" && event.payload.callId === id)?.payload.output;
    expect(argsOf("empty-string")).toEqual({ command: "npm test" });
    expect(outputOf("empty-string")).toBe("");
    expect(outputOf("empty-content")).toBe("");
    expect(outputOf("empty-array")).toEqual([]);
    expect(outputOf("empty-object")).toEqual({});
    expect(argsOf("keep-null")).toEqual({ command: "npm test" });
    expect(outputOf("keep-null")).toBe("temporary");
  });

  it("marks a terminal tool update that has no call as an orphan result", () => {
    const parsed = value(
      translateGrokRecords([
        grokRecord({ sessionUpdate: "tool_call_update", toolCallId: "c1", status: "completed", rawOutput: "done" }, 1)
      ])
    );
    expect(parsed.events.map((event) => event.kind)).toEqual(["tool_result"]);
    expect(parsed.events[0]?.payload).toEqual({ callId: "c1", isError: false, output: "done", orphan: true });
  });
});

describe("grok lenient reading", () => {
  it("reads a field of an unexpected type as absent", () => {
    const parsed = value(
      translateGrokRecords([
        grokRecord(
          { sessionUpdate: "user_message_chunk", content: "First", _meta: { promptIndex: "0", modelId: 7 } },
          1
        ),
        grokRecord({ sessionUpdate: 7, content: "not an update" }, 2),
        grokRecord(
          { sessionUpdate: "turn_completed", elapsed_ms: "25", usage: { inputTokens: 15, outputTokens: 4 } },
          3
        ),
        grokRecord({ sessionUpdate: "subagent_spawned", subagent_id: 7, description: "Look", status: 1 }, 4)
      ])
    );
    expect(parsed.events.find((event) => event.kind === "request")?.payload).toEqual({
      granularity: "turn",
      usage: { inputTokens: 15, outputTokens: 4, totalTokens: 19 }
    });
    expect(parsed.events.some((event) => event.payload.type === "turn_duration")).toBe(false);
    expect(parsed.events.find((event) => event.payload.type === "subagent_spawned")?.payload).toEqual({
      type: "subagent_spawned"
    });
    expect(parsed.agents.map((agent) => agent.id)).toEqual(["main"]);
    expect(parsed.events.filter((event) => event.kind === "user").map((event) => event.payload)).toEqual([
      { text: "First" }
    ]);
    expect(parsed.events.find((event) => event.kind === "unknown")?.payload).toEqual({ type: "update" });
  });

  it("keeps the hook runs it can read and drops the rest", () => {
    const parsed = value(
      translateGrokRecords([
        grokRecord({ sessionUpdate: "hook_execution", runs: "once" }, 1),
        grokRecord(
          {
            sessionUpdate: "hook_execution",
            runs: [
              "junk",
              { name: 5, status: "done" },
              { name: "lint", status: { status: "ok", elapsed_ms: "5", exit_code: 3 } }
            ]
          },
          2
        )
      ])
    );
    expect(parsed.events.filter((event) => event.kind === "hook").map((event) => event.payload.runs)).toEqual([
      [],
      [{}, { name: "lint", status: "ok", exitCode: 3 }]
    ]);
  });

  it("treats a present formatVersion as another generation and a wrong-typed schema_version as absent", () => {
    const record = {
      timestamp: 1767225600,
      params: { update: { sessionUpdate: "user_message_chunk", content: "x" } },
      formatVersion: 2
    };
    expect(translateGrokRecords([{ value: record, file: "updates.jsonl", line: 1, offset: 0, length: 1 }])).toEqual({
      ok: false,
      error: { _tag: "UnknownFormatGeneration", agent: "grok", file: "updates.jsonl", line: 1 }
    });
    const lenient = value(
      translateGrokRecords([grokRecord({ sessionUpdate: "user_message_chunk", content: "x", schema_version: "2" }, 1)])
    );
    expect(lenient.events[0]?.payload).toEqual({ text: "x" });
  });
});

describe("grok coalesce fallback", () => {
  it("falls back to the status field when a hook run's own exit_code or output has the wrong type", () => {
    const parsed = value(
      translateGrokRecords([
        grokRecord(
          {
            sessionUpdate: "hook_execution",
            runs: [
              { exit_code: "x", status: { status: "ok", exit_code: 3 } },
              { output: 5, status: { status: "ok", output: "from status" } }
            ]
          },
          1
        )
      ])
    );
    expect(parsed.events.find((event) => event.kind === "hook")?.payload.runs).toEqual([
      { status: "ok", exitCode: 3 },
      { status: "ok", output: "from status" }
    ]);
  });

  it("falls back to tokens_used when tokens_before has the wrong type", () => {
    const parsed = value(
      translateGrokRecords([
        grokRecord(
          { sessionUpdate: "auto_compact_completed", tokens_before: "500", tokens_used: 500, tokens_after: 80 },
          1
        )
      ])
    );
    expect(parsed.events.find((event) => event.kind === "compaction")?.payload).toEqual({
      trigger: "auto",
      preTokens: 500,
      postTokens: 80
    });
  });

  it("shows one request per model call, the last carrying the turn's aggregate", () => {
    const calls = {
      turns: new Map([
        [
          0,
          [
            { ts: 1000, model: "grok-a", toolCallIds: undefined },
            { ts: 2000, model: "grok-b", toolCallIds: undefined },
            { ts: undefined, model: undefined, toolCallIds: undefined }
          ]
        ]
      ])
    };
    const parsed = value(
      translateGrokRecords(
        [
          grokRecord(
            { sessionUpdate: "user_message_chunk", content: { type: "text", text: "Hi" }, _meta: { promptIndex: 0 } },
            1
          ),
          grokRecord(
            {
              sessionUpdate: "turn_completed",
              stop_reason: "end_turn",
              usage: { inputTokens: 30, outputTokens: 6, modelCalls: 3 }
            },
            2
          )
        ],
        { calls }
      )
    );
    const requests = parsed.events.filter((event) => event.kind === "request");
    // The aggregate is no model call of its own: three calls, three requests.
    expect(requests.map((event) => event.requestId)).toEqual(["0#0", "0#1", "0#2"]);
    expect(requests[0]?.payload).toEqual({ granularity: "request", model: "grok-a" });
    expect(requests[0]?.ts).toBe(1000);
    expect(requests[1]?.payload).toEqual({ granularity: "request", model: "grok-b" });
    expect(requests[1]?.ts).toBe(2000);
    // The turn's usage comes whole on the last call, never split across the calls.
    expect(requests[2]?.payload).toEqual({
      granularity: "turn",
      usage: { inputTokens: 30, outputTokens: 6, totalTokens: 36 },
      finishReason: "end_turn",
      modelCalls: 3
    });
    expect(requests[2]?.ts).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
    // The prompt joins the first call, as the turn-level request's prompt joins it.
    expect(parsed.events.find((event) => event.kind === "user")?.requestId).toBe("0#0");
  });

  it("splits the calls at tool results, not at whole-second record times", () => {
    // `updates.jsonl` writes epoch seconds; the second call's `first_token` (ms) falls after its first output's second.
    const secondCall = 1_767_225_602_400;
    const at = (update: Record<string, unknown>, line: number, timestamp: number) => ({
      value: { timestamp, params: { update } },
      file: "updates.jsonl",
      line,
      offset: line,
      length: 1
    });
    const calls = {
      turns: new Map([
        [
          0,
          [
            { ts: 1_767_225_601_200, model: "grok-a", toolCallIds: undefined },
            { ts: secondCall, model: "grok-b", toolCallIds: undefined }
          ]
        ]
      ])
    };
    const parsed = value(
      translateGrokRecords(
        [
          at(
            { sessionUpdate: "user_message_chunk", content: { type: "text", text: "Go" }, _meta: { promptIndex: 0 } },
            1,
            1_767_225_600
          ),
          at({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Look." } }, 2, 1_767_225_601),
          at({ sessionUpdate: "tool_call", toolCallId: "c1", title: "shell", status: "pending" }, 3, 1_767_225_601),
          at({ sessionUpdate: "tool_call_update", toolCallId: "c1", status: "completed" }, 4, 1_767_225_602),
          at({ sessionUpdate: "hook_execution", event_name: "PostToolUse", tool_name: "shell" }, 5, 1_767_225_602),
          at({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done." } }, 6, 1_767_225_602),
          at(
            { sessionUpdate: "turn_completed", usage: { inputTokens: 30, outputTokens: 6, modelCalls: 2 } },
            7,
            1_767_225_603
          )
        ],
        { calls }
      )
    );
    expect(parsed.events.map((event) => [event.kind, event.requestId])).toEqual([
      ["user", "0#0"],
      ["request", "0#0"],
      ["reasoning", "0#0"],
      ["tool_call", "0#0"],
      ["tool_result", "0#0"],
      ["hook", "0#0"],
      ["request", "0#1"],
      ["assistant", "0#1"]
    ]);
    // The request never sits later than the output it precedes: the record's whole second wins over `first_token`.
    expect(parsed.events[6]?.ts).toBe(parsed.events[7]?.ts);
    expect(parsed.events[1]?.ts).toBe(1_767_225_601_000);
  });

  it("keeps a tool call streamed after an earlier result in the call whose loop completed it", () => {
    const calls = {
      turns: new Map([
        [
          0,
          [
            { ts: 1000, model: "grok-a", toolCallIds: ["c1", "c2"] },
            { ts: 5000, model: "grok-a", toolCallIds: [] }
          ]
        ]
      ])
    };
    const parsed = value(
      translateGrokRecords(
        [
          grokRecord(
            { sessionUpdate: "user_message_chunk", content: { type: "text", text: "Go" }, _meta: { promptIndex: 0 } },
            1
          ),
          grokRecord({ sessionUpdate: "tool_call", toolCallId: "c1", title: "read", status: "pending" }, 2),
          grokRecord({ sessionUpdate: "tool_call_update", toolCallId: "c1", status: "completed" }, 3),
          grokRecord({ sessionUpdate: "tool_call", toolCallId: "c2", title: "read", status: "pending" }, 4),
          grokRecord({ sessionUpdate: "tool_call_update", toolCallId: "c2", status: "completed" }, 5),
          grokRecord({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done." } }, 6),
          grokRecord({ sessionUpdate: "turn_completed", usage: { inputTokens: 9, outputTokens: 1, modelCalls: 2 } }, 7)
        ],
        { calls }
      )
    );
    expect(parsed.events.map((event) => [event.kind, event.requestId])).toEqual([
      ["user", "0#0"],
      ["request", "0#0"],
      ["tool_call", "0#0"],
      ["tool_result", "0#0"],
      ["tool_call", "0#0"],
      ["tool_result", "0#0"],
      ["request", "0#1"],
      ["assistant", "0#1"]
    ]);
  });

  it("keeps a server-side tool's call and result in the call that made them", () => {
    const calls = {
      turns: new Map([
        [
          0,
          [
            { ts: 1000, model: "grok-a", toolCallIds: ["call-1"] },
            { ts: 5000, model: "grok-a", toolCallIds: [] }
          ]
        ]
      ])
    };
    const parsed = value(
      translateGrokRecords(
        [
          grokRecord(
            { sessionUpdate: "user_message_chunk", content: { type: "text", text: "Go" }, _meta: { promptIndex: 0 } },
            1
          ),
          grokRecord({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Search." } }, 2),
          grokRecord({ sessionUpdate: "tool_call", toolCallId: "ws_1", title: "web search", status: "pending" }, 3),
          grokRecord({ sessionUpdate: "tool_call_update", toolCallId: "ws_1", status: "completed" }, 4),
          grokRecord({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Read." } }, 5),
          grokRecord({ sessionUpdate: "tool_call", toolCallId: "call-1", title: "read", status: "pending" }, 6),
          grokRecord({ sessionUpdate: "tool_call_update", toolCallId: "call-1", status: "completed" }, 7),
          grokRecord({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done." } }, 8),
          grokRecord({ sessionUpdate: "turn_completed", usage: { inputTokens: 9, outputTokens: 1, modelCalls: 2 } }, 9)
        ],
        { calls }
      )
    );
    expect(parsed.events.map((event) => [event.kind, event.requestId])).toEqual([
      ["user", "0#0"],
      ["request", "0#0"],
      ["reasoning", "0#0"],
      ["tool_call", "0#0"],
      ["tool_result", "0#0"],
      ["reasoning", "0#0"],
      ["tool_call", "0#0"],
      ["tool_result", "0#0"],
      ["request", "0#1"],
      ["assistant", "0#1"]
    ]);
  });

  it("places a repeated turn_completed's request once at the end, keeping the calls placed", () => {
    const calls = {
      turns: new Map([
        [
          0,
          [
            { ts: 1000, model: "grok-a", toolCallIds: undefined },
            { ts: 2000, model: "grok-b", toolCallIds: undefined }
          ]
        ]
      ])
    };
    const completed = { sessionUpdate: "turn_completed", usage: { inputTokens: 30, outputTokens: 6, modelCalls: 2 } };
    const parsed = value(
      translateGrokRecords(
        [
          grokRecord(
            { sessionUpdate: "user_message_chunk", content: { type: "text", text: "Hi" }, _meta: { promptIndex: 0 } },
            1
          ),
          grokRecord(completed, 2),
          grokRecord({ sessionUpdate: "turn_completed", stop_reason: "end_turn" }, 3)
        ],
        { calls }
      )
    );
    const requests = parsed.events.filter((event) => event.kind === "request");
    expect(requests.map((event) => [event.requestId, event.payload.granularity])).toEqual([
      ["0#0", "request"],
      ["0#1", "turn"],
      ["0", "turn"]
    ]);
    // The repeat is a turn-level request at its own record time, not a second set of calls.
    expect(requests[2]?.ts).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
    expect(new Set(parsed.events.map((event) => event.id)).size).toBe(parsed.events.length);
  });

  it("keeps the turn-level request when the join names one call or none", () => {
    const single = { turns: new Map([[0, [{ ts: 1000, model: "grok-a", toolCallIds: undefined }]]]) };
    const records = [
      grokRecord(
        { sessionUpdate: "user_message_chunk", content: { type: "text", text: "Hi" }, _meta: { promptIndex: 0 } },
        1
      ),
      grokRecord({ sessionUpdate: "turn_completed", usage: { inputTokens: 30, outputTokens: 6, modelCalls: 1 } }, 2)
    ];
    for (const calls of [undefined, single]) {
      const parsed = value(translateGrokRecords(records, ...(calls === undefined ? [] : [{ calls }])));
      const requests = parsed.events.filter((event) => event.kind === "request");
      expect(requests).toHaveLength(1);
      expect(requests[0]?.payload.granularity).toBe("turn");
      expect(requests[0]?.payload.usage).toEqual({ inputTokens: 30, outputTokens: 6, totalTokens: 36 });
    }
  });
});
