import type { TranscriptEvent, TranscriptEventKind } from "../../domain/transcript/index.js";
import { asNumber, asRecord, asString } from "../record-fields.js";

/** User-role text that Codex injects (environment, instructions, notifications). Not prompts. */
export const INJECTED_USER: RegExp =
  /^\s*(?:<(?:environment_context|user_instructions|turn_aborted|subagent_notification|skill|recommended_plugins|heartbeat|goal_context|codex_delegation|hook_prompt|codex_internal_context)>|# AGENTS\.md instructions)/;

/** The text of a content value: a string, or the `text` (or `output`) parts of an array joined. */
export function textFrom(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  const parts: string[] = [];
  for (const part of content) {
    const item = asRecord(part);
    const text = asString(item?.text) ?? asString(item?.output);
    if (text) {
      parts.push(text);
    }
  }
  return parts.length > 0 ? parts.join("") : undefined;
}

export type EmitEvent = (kind: TranscriptEventKind, payload: Record<string, unknown>) => TranscriptEvent;

/**
 * Emits the event of one response item (`response_item.payload`, or a bare item of an older rollout). The caller
 * handles `compaction` items; any type not listed here becomes an `unknown` event.
 */
export function emitResponseItem(type: string, item: Record<string, unknown>, emit: EmitEvent): TranscriptEvent {
  switch (type) {
    case "message":
      return emitMessage(item, emit);
    case "agent_message": {
      // A message between agents (`author` → `recipient`), not this model's own reply.
      const text = textFrom(item.content);
      const author = asString(item.author);
      const recipient = asString(item.recipient);
      return emit("system", {
        type: "agent_message",
        ...(author ? { author } : {}),
        ...(recipient ? { recipient } : {}),
        ...(text ? { text } : {})
      });
    }
    case "reasoning": {
      const text = textFrom(item.summary);
      return emit("reasoning", text ? { text } : { redacted: true });
    }
    case "web_search_call":
      return emit("tool_call", {
        callId: asString(item.call_id) ?? asString(item.id) ?? "",
        name: "web_search",
        ...(item.action === undefined ? {} : { args: item.action })
      });
    case "tool_search_call":
      return emit("tool_call", {
        callId: asString(item.call_id) ?? "",
        name: "tool_search",
        ...(item.arguments === undefined ? {} : { args: item.arguments })
      });
    case "tool_search_output": {
      const status = asString(item.status);
      return emit("tool_result", {
        callId: asString(item.call_id) ?? "",
        ...(item.tools === undefined ? {} : { output: item.tools }),
        ...(status === "failed" || status === "error" ? { isError: true } : {})
      });
    }
    case "function_call":
    case "custom_tool_call": {
      const args = item.arguments ?? item.input;
      return emit("tool_call", {
        callId: asString(item.call_id) ?? "",
        name: asString(item.name) ?? "",
        ...(args === undefined ? {} : { args: argsOf(args) })
      });
    }
    case "function_call_output":
    case "custom_tool_call_output":
      return emit("tool_result", {
        callId: asString(item.call_id) ?? "",
        ...resultFlags(item.output),
        ...(item.output === undefined ? {} : { output: item.output })
      });
    default:
      return emit("unknown", { type });
  }
}

/** A `developer` message is instructions the host sent, so it is a `system` event, not a user prompt. */
function emitMessage(item: Record<string, unknown>, emit: EmitEvent): TranscriptEvent {
  const role = asString(item.role);
  const text = textFrom(item.content);
  const body = text ? { text } : {};
  if (role === "developer") {
    return emit("system", { ...body, injected: true });
  }
  if (role === "user") {
    return emit("user", { ...body, ...(text !== undefined && INJECTED_USER.test(text) ? { injected: true } : {}) });
  }
  return emit(role === "assistant" ? "assistant" : "system", body);
}

/** Function call arguments are a JSON string; a string that is not JSON stays as it is. */
function argsOf(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/** Exit-code headers Codex writes before a shell tool's output. */
const EXIT_LINE = /^(?:Exit code: |Process exited with code )(-?\d+)$/m;

function resultFlags(output: unknown): { isError?: boolean; exitCode?: number } {
  const exitCode = exitCodeOf(output);
  return exitCode === undefined ? {} : { exitCode, isError: exitCode !== 0 };
}

/** `metadata.exit_code` of a JSON output, else the `Exit code:` header line in the lines before `Output:`. */
function exitCodeOf(output: unknown): number | undefined {
  if (typeof output !== "string") {
    return undefined;
  }
  if (output.startsWith("{")) {
    try {
      const code = asNumber(asRecord(asRecord(JSON.parse(output) as unknown)?.metadata)?.exit_code);
      if (code !== undefined) {
        return code;
      }
    } catch {
      // Not JSON; read the text header below.
    }
  }
  const header = output.split("\nOutput:", 1)[0]!.split("\n", 6).join("\n");
  const match = EXIT_LINE.exec(header);
  return match ? Number(match[1]) : undefined;
}
