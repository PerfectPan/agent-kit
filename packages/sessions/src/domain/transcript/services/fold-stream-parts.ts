import type { LiveTranscriptEvent, TranscriptStreamPart } from "../value-objects/stream-part.js";
import type { TranscriptEventKind } from "../value-objects/transcript-event.js";

/** Turns stream parts into completed events as they arrive. */
export interface StreamFolder {
  /** The events `part` completes, stamped with `ts`; most deltas complete none. */
  push(part: TranscriptStreamPart, ts: number): LiveTranscriptEvent[];
}

interface ToolFold {
  name: string;
  input?: unknown;
  called: boolean;
}

/**
 * A folder for one stream of parts, such as one live turn. Text and reasoning become one event each at their `*-end`; a
 * tool call becomes a `tool_call` and a `tool_result` once its output is available, so the call carries its final
 * input; `finish` closes what is still open, lists the calls that never ended without a result, and adds the turn's
 * `request`. `event` parts are skipped: they are what the folder produces.
 */
export function createStreamFolder(): StreamFolder {
  let seq = 0;
  const texts = new Map<string, { kind: "assistant" | "reasoning"; text: string }>();
  const tools = new Map<string, ToolFold>();

  const event = (
    kind: TranscriptEventKind,
    id: string,
    payload: Record<string, unknown>,
    ts: number,
    original?: unknown
  ): LiveTranscriptEvent => ({ id, seq: seq++, ts, kind, payload, ...(original === undefined ? {} : { original }) });

  const closeText = (id: string, ts: number): LiveTranscriptEvent[] => {
    const open = texts.get(id);
    if (open === undefined) {
      return [];
    }
    texts.delete(id);
    return [event(open.kind, `${open.kind}:${id}`, open.text ? { text: open.text } : {}, ts)];
  };

  const call = (callId: string, tool: ToolFold, ts: number): LiveTranscriptEvent[] => {
    if (tool.called) {
      return [];
    }
    tool.called = true;
    const payload = { callId, name: tool.name, ...(tool.input === undefined ? {} : { args: tool.input }) };
    return [event("tool_call", `tool_call:${callId}`, payload, ts)];
  };

  const toolOf = (callId: string, name = ""): ToolFold => {
    const tool = tools.get(callId) ?? { name, called: false };
    if (name && !tool.name) {
      tool.name = name;
    }
    tools.set(callId, tool);
    return tool;
  };

  return {
    push(part, ts) {
      switch (part.type) {
        case "text-start":
        case "reasoning-start":
          texts.set(part.id, { kind: part.type === "text-start" ? "assistant" : "reasoning", text: "" });
          return [];
        case "text-delta":
        case "reasoning-delta": {
          const kind = part.type === "text-delta" ? "assistant" : "reasoning";
          const open = texts.get(part.id) ?? { kind, text: "" };
          open.text += part.delta;
          texts.set(part.id, open);
          return [];
        }
        case "text-end":
        case "reasoning-end":
          return closeText(part.id, ts);
        case "tool-input-start":
          toolOf(part.toolCallId, part.toolName);
          return [];
        case "tool-input-available": {
          const tool = toolOf(part.toolCallId, part.toolName);
          tool.input = part.input;
          return [];
        }
        case "tool-output-available":
        case "tool-output-error": {
          const tool = toolOf(part.toolCallId);
          tools.delete(part.toolCallId);
          const payload = {
            callId: part.toolCallId,
            isError: part.type === "tool-output-error",
            ...(part.output === undefined ? {} : { output: part.output })
          };
          return [
            ...call(part.toolCallId, tool, ts),
            event("tool_result", `tool_result:${part.toolCallId}`, payload, ts)
          ];
        }
        case "update":
          return [event(part.kind, `update:${part.id}`, { ...part.payload }, ts, part.original)];
        case "finish": {
          const closed = [...texts.keys()].flatMap((id) => closeText(id, ts));
          const calls = [...tools].flatMap(([callId, tool]) => call(callId, tool, ts));
          const payload = {
            granularity: "turn",
            finishReason: part.finishReason,
            ...(part.usage === undefined ? {} : { usage: part.usage })
          };
          return [...closed, ...calls, event("request", `request:${part.id}`, payload, ts)];
        }
        case "event":
          return [];
      }
    }
  };
}

/**
 * The completed events of a list of stream parts, such as the deltas a consumer kept or forwarded, stamped with
 * `now()` as each completes. The live stream's own `event` parts are skipped, so folding a turn's whole stream gives
 * the events it carried, with other times.
 */
export function foldStreamParts(
  parts: Iterable<TranscriptStreamPart>,
  now: () => number = Date.now
): LiveTranscriptEvent[] {
  const folder = createStreamFolder();
  const events: LiveTranscriptEvent[] = [];
  for (const part of parts) {
    events.push(...folder.push(part, now()));
  }
  return events;
}
