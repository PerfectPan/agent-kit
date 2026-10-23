import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  createAcpPartTranslator,
  createStreamFolder,
  foldStreamParts,
  type SourcedRecord,
  type TranscriptStreamPart
} from "@rivus/agent-kit-sessions/public";
import { translateGrokRecords } from "@rivus/agent-kit-provider-grok/sessions";
import { connectAgent, MemorySessionBindingStoreLive, type PromptBlock } from "@rivus/agent-kit-acp/public";
import { NodePlatformLive } from "@rivus/agent-kit-platform-node/public/effect";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

/** The tool state a session's turns share, as the translator's optional second parameter names it. */
type SharedToolState = NonNullable<Parameters<typeof createAcpPartTranslator>[1]>;

/** The acp package's fake agent, run as a child process; the tests reach it by path, not by import. */
const FAKE_AGENT = fileURLToPath(new URL("../../acp/test/fixtures/fake-agent.ts", import.meta.url));
const TestLive = Layer.mergeAll(NodePlatformLive, MemorySessionBindingStoreLive);
const text = (value: string): PromptBlock => ({ type: "text", text: value });

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const workDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "grok-acp-"));
  dirs.push(dir);
  return dir;
};

/** The parts of a list of updates and a final answer, through one translator. */
function translate(updates: readonly Record<string, unknown>[], stopReason = "end_turn"): TranscriptStreamPart[] {
  const translator = createAcpPartTranslator("t.");
  return [...updates.flatMap((update) => translator.update(update)), ...translator.finish({ stopReason })];
}

const TOOL_UPDATES = [
  { sessionUpdate: "tool_call", toolCallId: "c1", title: "bash", status: "pending", rawInput: { cmd: "ls" } },
  { sessionUpdate: "tool_call_update", toolCallId: "c1", status: "in_progress", rawInput: null },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "c1",
    status: "failed",
    content: [{ type: "content", content: { type: "text", text: "no such dir" } }]
  }
];

/** A Grok `tool_call` for `read_file` and the later `tool_call_update` that shows a display title and the full args. */
const GROK_TITLE_UPDATES = [
  {
    sessionUpdate: "tool_call",
    toolCallId: "c1",
    title: "read_file",
    rawInput: { path: "/u/me/x.md", background: false }
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "c1",
    title: "Read `/u/me/x.md`",
    rawInput: { path: "/u/me/x.md", variant: "content", "-i": false, type: "text", multiline: false },
    status: "completed",
    content: [{ type: "content", content: { type: "text", text: "file body" } }]
  }
] as const;

const MERGED_ARGS = {
  path: "/u/me/x.md",
  background: false,
  variant: "content",
  "-i": false,
  type: "text",
  multiline: false
};

describe("S89: Grok logs and live turns read ACP updates with the same rules", () => {
  /** The recorded events one list of updates produces, as `[kind, payload]` pairs, through the Grok translation. */
  const recordedOf = (
    updates: readonly Record<string, unknown>[],
    kinds: readonly string[] = ["tool_call"]
  ): [string, Record<string, unknown>][] => {
    const records: SourcedRecord[] = updates.map((update, index) => ({
      file: "updates.jsonl",
      offset: index * 100,
      length: 100,
      line: index + 1,
      value: { timestamp: "2026-01-01T00:00:00.000Z", params: { update } }
    }));
    const grok = translateGrokRecords(records);
    if (!grok.ok) {
      throw new Error(grok.error._tag);
    }
    return grok.value.events.filter((event) => kinds.includes(event.kind)).map((event) => [event.kind, event.payload]);
  };

  /** The events the same list of updates produces live, as `[kind, payload]` pairs, through one translator. */
  const liveOf = (
    updates: readonly Record<string, unknown>[],
    kinds: readonly string[] = ["tool_call"]
  ): [string, Record<string, unknown>][] =>
    foldStreamParts(translate(updates))
      .filter((event) => kinds.includes(event.kind))
      .map((event) => [event.kind, event.payload]);

  /** The `[kind, payload]` pairs of one part stream's completed events, whatever their kind. */
  const allEventsOf = (parts: readonly TranscriptStreamPart[]): [string, Record<string, unknown>][] =>
    parts.flatMap((part) => (part.type === "event" ? [[part.event.kind, part.event.payload] as const] : []));

  /** The `[kind, payload]` pairs of one part stream's completed events of the given kinds. */
  const eventsOf = (
    parts: readonly TranscriptStreamPart[],
    kinds: readonly string[]
  ): [string, Record<string, unknown>][] =>
    parts.flatMap((part): [string, Record<string, unknown>][] =>
      part.type === "event" && kinds.includes(part.event.kind) ? [[part.event.kind, part.event.payload]] : []
    );

  /**
   * The parts of one session's live turns, through the production path: `connectAgent` runs the acp package's fake
   * agent, whose `FAKE_ACP_REPLAY` script replays each turn's updates, and the session keeps the shared tool state
   * and one stream folder across its turns, as the live ACP path composes them. A script turn's `fail` fails the
   * prompt after its updates.
   */
  const liveTurns = async (
    turns: readonly { readonly updates?: readonly Record<string, unknown>[]; readonly fail?: boolean }[]
  ): Promise<{ readonly parts: TranscriptStreamPart[]; readonly failed: readonly boolean[] }> => {
    const cwd = workDir();
    const script = join(cwd, "replay.json");
    writeFileSync(script, JSON.stringify(turns));
    return Effect.runPromise(
      Effect.gen(function* () {
        const connection = yield* connectAgent("fake-agent", {
          cwd,
          env: { FAKE_ACP_REPLAY: script },
          providers: {
            acp: {
              "fake-agent": {
                specificationVersion: "acp-v1",
                agent: "fake-agent",
                command: process.execPath,
                args: [FAKE_AGENT],
                env: [],
                systemPrompt: { in: "meta", key: "systemPrompt" },
                warnings: []
              }
            }
          }
        });
        const session = yield* connection.newSession();
        const parts: TranscriptStreamPart[] = [];
        const failed: boolean[] = [];
        for (let index = 0; index < turns.length; index += 1) {
          const exit = yield* Effect.exit(
            Stream.runForEach(
              Stream.tap(session.prompt([text("t")]), (part) => Effect.sync(() => parts.push(part))),
              () => Effect.void
            )
          );
          failed.push(Exit.isFailure(exit));
        }
        return { parts, failed };
      }).pipe(Effect.scoped, Effect.provide(TestLive))
    );
  };

  it("merges a tool call's updates into the same call and result", () => {
    expect(liveOf(TOOL_UPDATES, ["tool_call", "tool_result"])).toEqual(
      recordedOf(TOOL_UPDATES, ["tool_call", "tool_result"])
    );
  });

  it("reads a titled call and its display-title update to the same name, title and args on both paths", () => {
    expect(liveOf(GROK_TITLE_UPDATES)).toEqual(recordedOf(GROK_TITLE_UPDATES));
    expect(liveOf(GROK_TITLE_UPDATES)[0]?.[1]).toEqual({
      callId: "c1",
      name: "read_file",
      title: "Read `/u/me/x.md`",
      args: MERGED_ARGS
    });
  });

  it("carries a title-only later update into the live fold like the Grok log", () => {
    const updates = [
      { sessionUpdate: "tool_call", toolCallId: "c1", title: "bash", rawInput: { command: "ls" } },
      { sessionUpdate: "tool_call_update", toolCallId: "c1", title: "List files" }
    ];
    expect(liveOf(updates)).toEqual(recordedOf(updates));
    expect(liveOf(updates)[0]?.[1]).toEqual({
      callId: "c1",
      name: "bash",
      title: "List files",
      args: { command: "ls" }
    });
  });

  it("reads a display title that arrives on the completed update without input (OpenCode shape) on both paths", () => {
    const updates = [
      {
        sessionUpdate: "tool_call",
        toolCallId: "c1",
        title: "run_terminal_command",
        rawInput: { command: "ls -la" }
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "c1",
        title: "List `.`",
        status: "completed",
        content: "file one"
      }
    ];
    expect(liveOf(updates)).toEqual(recordedOf(updates));
    expect(liveOf(updates)[0]?.[1]).toEqual({
      callId: "c1",
      name: "run_terminal_command",
      title: "List `.`",
      args: { command: "ls -la" }
    });
  });

  it("clears the title again on both paths when a later title equals the name", () => {
    const updates = [
      { sessionUpdate: "tool_call", toolCallId: "c1", title: "bash", rawInput: { command: "ls" } },
      { sessionUpdate: "tool_call_update", toolCallId: "c1", title: "List files" },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "c1",
        title: "bash",
        status: "completed",
        content: "done"
      }
    ];
    const live = liveOf(updates);
    const recorded = recordedOf(updates);
    expect(live).toEqual(recorded);
    expect(live[0]?.[1]).toEqual({ callId: "c1", name: "bash", args: { command: "ls" } });
    expect("title" in live[0]![1]).toBe(false);
    expect("title" in recorded[0]![1]).toBe(false);
  });

  it("reads a call completed after its turn as one tool_call and the late result, like the log", async () => {
    const start = {
      sessionUpdate: "tool_call",
      toolCallId: "c1",
      title: "run_bg",
      status: "in_progress",
      rawInput: { command: "sleep 100" }
    };
    const complete = {
      sessionUpdate: "tool_call_update",
      toolCallId: "c1",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "background done" } }]
    };
    const { parts } = await liveTurns([{ updates: [start] }, { updates: [complete] }]);
    expect(eventsOf(parts, ["tool_call", "tool_result"])).toEqual(
      recordedOf([start, complete], ["tool_call", "tool_result"])
    );
  });

  it("keeps a call that starts and ends within one turn on the same events as its own fold", async () => {
    const turns = [
      [
        { sessionUpdate: "tool_call", toolCallId: "c1", title: "bash", rawInput: { command: "ls" } },
        {
          sessionUpdate: "tool_call_update",
          toolCallId: "c1",
          status: "completed",
          content: [{ type: "content", content: { type: "text", text: "files" } }]
        }
      ],
      [
        { sessionUpdate: "tool_call", toolCallId: "c2", title: "grep", rawInput: { pattern: "x" } },
        {
          sessionUpdate: "tool_call_update",
          toolCallId: "c2",
          status: "failed",
          content: [{ type: "content", content: { type: "text", text: "no match" } }]
        }
      ]
    ];
    const { parts } = await liveTurns(turns.map((updates) => ({ updates })));
    const model = turns.flatMap((updates) => foldStreamParts(translate(updates)));
    expect(allEventsOf(parts)).toEqual(model.map((event) => [event.kind, event.payload] as const));
  });

  it("gives two sessions that reuse a call id their own tool_call", async () => {
    const turns = [
      { updates: [{ sessionUpdate: "tool_call", toolCallId: "c1", title: "bash", rawInput: { command: "ls" } }] },
      {
        updates: [
          {
            sessionUpdate: "tool_call_update",
            toolCallId: "c1",
            status: "completed",
            content: [{ type: "content", content: { type: "text", text: "files" } }]
          }
        ]
      }
    ];
    for (const session of [await liveTurns(turns), await liveTurns(turns)]) {
      expect(eventsOf(session.parts, ["tool_call"])).toEqual([
        ["tool_call", { callId: "c1", name: "bash", args: { command: "ls" } }]
      ]);
    }
  });

  it("reads a call whose turn failed after its result as one call, and an update for the ended call as nothing", async () => {
    const start = {
      sessionUpdate: "tool_call",
      toolCallId: "c1",
      title: "run_bg",
      status: "in_progress",
      rawInput: { command: "sleep 100" }
    };
    const complete = {
      sessionUpdate: "tool_call_update",
      toolCallId: "c1",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "background done" } }]
    };
    const lateInput = { sessionUpdate: "tool_call_update", toolCallId: "c1", rawInput: { cwd: "/w" } };
    const { parts, failed } = await liveTurns([{ updates: [start, complete], fail: true }, { updates: [lateInput] }]);
    expect(failed).toEqual([true, false]);
    expect(parts.flatMap((part) => (part.type.startsWith("tool-") ? [part.type] : []))).toEqual([
      "tool-input-start",
      "tool-input-available",
      "tool-output-available"
    ]);
    expect(eventsOf(parts, ["tool_call", "tool_result"])).toEqual([
      ["tool_call", { callId: "c1", name: "run_bg", args: { command: "sleep 100" } }],
      ["tool_result", { callId: "c1", isError: false, output: "background done" }]
    ]);
    const ids = parts.flatMap((part) => (part.type === "event" ? [part.event.id] : []));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("emits nothing for an update to a call whose result is out, in its own turn or a later one", async () => {
    const start = {
      sessionUpdate: "tool_call",
      toolCallId: "c1",
      title: "run_bg",
      status: "in_progress",
      rawInput: { command: "sleep 100" }
    };
    const complete = {
      sessionUpdate: "tool_call_update",
      toolCallId: "c1",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "background done" } }]
    };
    const { parts } = await liveTurns([
      {
        updates: [
          start,
          complete,
          { sessionUpdate: "tool_call_update", toolCallId: "c1", rawInput: { cwd: "/w" } },
          { sessionUpdate: "tool_call_update", toolCallId: "c1", status: "completed" }
        ]
      },
      { updates: [{ sessionUpdate: "tool_call_update", toolCallId: "c1", rawInput: { cwd: "/w" } }] }
    ]);
    expect(parts.flatMap((part) => (part.type.startsWith("tool-") ? [part.type] : []))).toEqual([
      "tool-input-start",
      "tool-input-available",
      "tool-output-available"
    ]);
    expect(eventsOf(parts, ["tool_call", "tool_result"])).toEqual([
      ["tool_call", { callId: "c1", name: "run_bg", args: { command: "sleep 100" } }],
      ["tool_result", { callId: "c1", isError: false, output: "background done" }]
    ]);
  });

  it("completes a call its turn left open once, with its input, when a later turn ends it", async () => {
    const start = {
      sessionUpdate: "tool_call",
      toolCallId: "c1",
      title: "run_bg",
      status: "in_progress",
      rawInput: { command: "sleep 100" }
    };
    const complete = {
      sessionUpdate: "tool_call_update",
      toolCallId: "c1",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "background done" } }]
    };
    const { parts, failed } = await liveTurns([{ updates: [start], fail: true }, { updates: [complete] }]);
    expect(failed).toEqual([true, false]);
    expect(eventsOf(parts, ["tool_call", "tool_result"])).toEqual(
      recordedOf([start, complete], ["tool_call", "tool_result"])
    );
    expect(eventsOf(parts, ["tool_call"])[0]?.[1]).toEqual({
      callId: "c1",
      name: "run_bg",
      args: { command: "sleep 100" }
    });
  });

  it("drops an ended call's input and output from the shared state, keeping only its end", () => {
    const state: SharedToolState = { tools: new Map(), ended: new Set(), closed: new Set() };
    const folder = createStreamFolder();
    const translator = createAcpPartTranslator("t.", state);
    for (const part of [
      ...translator.update({
        sessionUpdate: "tool_call",
        toolCallId: "c1",
        title: "run_bg",
        rawInput: { command: "sleep 100" }
      }),
      ...translator.update({
        sessionUpdate: "tool_call_update",
        toolCallId: "c1",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: "done" } }]
      })
    ]) {
      folder.push(part, 1);
    }
    const ended = state.tools.get("c1");
    expect(ended).toBeDefined();
    expect("args" in ended!).toBe(false);
    expect("output" in ended!).toBe(false);
    // A later update for the ended call emits no event and keeps no input or output in the state.
    const late = translator.update({
      sessionUpdate: "tool_call_update",
      toolCallId: "c1",
      rawInput: { command: "sleep 100", cwd: "/w" }
    });
    expect(late.flatMap((part) => folder.push(part, 1))).toEqual([]);
    expect("args" in state.tools.get("c1")!).toBe(false);
    expect("output" in state.tools.get("c1")!).toBe(false);
  });
});
