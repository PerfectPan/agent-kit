import { describe, expect, it } from "vite-plus/test";
import {
  createAcpPartTranslator,
  createStreamFolder,
  foldStreamParts,
  type SourcedRecord,
  type TranscriptStreamPart
} from "@rivus/agent-kit-sessions/public";
import { translateGrokRecords } from "@rivus/agent-kit-provider-grok/sessions";

/** The tool state a session's turns share, as the translator's optional second parameter names it. */
type SharedToolState = NonNullable<Parameters<typeof createAcpPartTranslator>[1]>;

/** One live turn's updates. */
type TurnUpdates = readonly Record<string, unknown>[];

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

  /** The `[kind, payload]` pairs of one part stream's completed events of the given kinds. */
  const eventsOf = (
    parts: readonly TranscriptStreamPart[],
    kinds: readonly string[]
  ): [string, Record<string, unknown>][] =>
    parts.flatMap((part): [string, Record<string, unknown>][] =>
      part.type === "event" && kinds.includes(part.event.kind) ? [[part.event.kind, part.event.payload]] : []
    );

  /**
   * The parts of one session's live turns, through the composition the live ACP path runs: a translator per turn
   * over the session's shared tool state, and one stream folder for the whole session, whose events become the
   * `event` parts. `ok` names the turns whose prompt succeeds; a failed turn sends no finish. With `shared` off,
   * every turn translates and folds from scratch, as a session that forgot a call between turns would read.
   */
  const liveTurnsOf = (
    turns: readonly TurnUpdates[],
    ok: readonly boolean[] = turns.map(() => true),
    shared = true
  ): TranscriptStreamPart[] => {
    const state: SharedToolState | undefined = shared ? { tools: new Map(), ended: new Set() } : undefined;
    const folder = createStreamFolder();
    const parts: TranscriptStreamPart[] = [];
    turns.forEach((updates, index) => {
      const translator = createAcpPartTranslator(`${index}.`, state);
      const turn = [
        ...updates.flatMap((update) => translator.update(update)),
        ...(ok[index] ? translator.finish({ stopReason: "end_turn" }) : [])
      ];
      const turnFolder = shared ? folder : createStreamFolder();
      for (const part of turn) {
        parts.push(part);
        for (const event of turnFolder.push(part, 1)) {
          parts.push({ type: "event", event });
        }
      }
    });
    return parts;
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

  it("reads a call completed after its turn as one tool_call and the late result, like the log", () => {
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
    expect(eventsOf(liveTurnsOf([[start], [complete]]), ["tool_call", "tool_result"])).toEqual(
      recordedOf([start, complete], ["tool_call", "tool_result"])
    );
  });

  it("keeps a call that starts and ends within one turn on the same parts as fresh per-turn folds", () => {
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
    expect(liveTurnsOf(turns)).toEqual(liveTurnsOf(turns, undefined, false));
  });

  it("gives two sessions that reuse a call id their own tool_call", () => {
    const turns = [
      [{ sessionUpdate: "tool_call", toolCallId: "c1", title: "bash", rawInput: { command: "ls" } }],
      [
        {
          sessionUpdate: "tool_call_update",
          toolCallId: "c1",
          status: "completed",
          content: [{ type: "content", content: { type: "text", text: "files" } }]
        }
      ]
    ];
    for (const session of [liveTurnsOf(turns), liveTurnsOf(turns)]) {
      expect(eventsOf(session, ["tool_call"])).toEqual([
        ["tool_call", { callId: "c1", name: "bash", args: { command: "ls" } }]
      ]);
    }
  });

  it("reads a call whose turn failed after its result as one call, and the late input update as no new call", () => {
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
    const parts = liveTurnsOf([[start, complete], [lateInput]], [false, true]);
    expect(parts.flatMap((part) => (part.type.startsWith("tool-") ? [part.type] : []))).toEqual([
      "tool-input-start",
      "tool-input-available",
      "tool-output-available",
      "tool-input-start",
      "tool-input-available"
    ]);
    expect(eventsOf(parts, ["tool_call", "tool_result"])).toEqual([
      ["tool_call", { callId: "c1", name: "run_bg", args: { command: "sleep 100" } }],
      ["tool_result", { callId: "c1", isError: false, output: "background done" }]
    ]);
    const ids = parts.flatMap((part) => (part.type === "event" ? [part.event.id] : []));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("completes a call its turn left open once, with its input, when a later turn ends it", () => {
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
    const parts = liveTurnsOf([[start], [complete]], [false, true]);
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
    const state: SharedToolState = { tools: new Map(), ended: new Set() };
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
