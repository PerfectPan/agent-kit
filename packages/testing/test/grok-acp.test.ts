import { describe, expect, it } from "vite-plus/test";
import {
  createAcpPartTranslator,
  foldStreamParts,
  type SourcedRecord,
  type TranscriptStreamPart
} from "@rivus/agent-kit-sessions";
import { translateGrokRecords } from "@rivus/agent-kit-provider-grok/sessions";

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
});
