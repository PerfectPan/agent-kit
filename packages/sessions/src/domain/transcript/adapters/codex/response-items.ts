import * as z from "zod/mini";

import type { TranscriptEvent, TranscriptEventKind } from "../../index.js";
import { lenient } from "../lenient.js";
import type { CodexPayloadValue } from "./records.js";

/** User-role text that Codex injects (environment, instructions, notifications). Not prompts. */
export const INJECTED_USER: RegExp =
  /^\s*(?:<(?:environment_context|user_instructions|turn_aborted|subagent_notification|skill|recommended_plugins|heartbeat|goal_context|codex_delegation|hook_prompt|codex_internal_context)>|# AGENTS\.md instructions)/;

/** The text fields of one content part: `text` wins over `output`. */
const ContentPart = z.looseObject({
  text: lenient(z.string()),
  output: lenient(z.string())
});

/** A content value: a string, or an array of parts whose parts that are not objects are skipped. */
const ContentText = z.union([z.string(), z.array(lenient(ContentPart))]);

/** The text of a content value: a string, or the `text` (or `output`) parts of an array joined. */
export function textFrom(content: unknown): string | undefined {
  const value = z.safeParse(ContentText, content).data;
  if (typeof value === "string") {
    return value;
  }
  const parts = (value ?? [])
    .map((part) => part?.text ?? part?.output)
    .filter((text) => text !== undefined && text !== "");
  return parts.length > 0 ? parts.join("") : undefined;
}

export type EmitEvent = (kind: TranscriptEventKind, payload: Record<string, unknown>) => unknown;

/** The event of one response item, with what its payload carries for the translator's passes: the `text`, and for a
 * tool event the `callId` and the `output` exactly as the event's body holds them. */
export interface EmittedResponseItem {
  event: TranscriptEvent;
  text?: string;
  callId?: string;
  output?: unknown;
}

function emitted(event: unknown, extra: Omit<EmittedResponseItem, "event"> = {}): EmittedResponseItem {
  // The sink the caller supplies builds its own event shape; the item emitter only hands it through.
  return { event: event as TranscriptEvent, ...extra };
}

/** A `developer` message is instructions the host sent, so it is a `system` event, not a user prompt. */
function emitMessage(item: CodexPayloadValue, emit: EmitEvent): EmittedResponseItem {
  const role = item.role;
  const text = textFrom(item.content);
  const body = text ? { text } : {};
  if (role === "developer") {
    return emitted(emit("system", { ...body, injected: true }), text ? { text } : {});
  }
  if (role === "user") {
    return emitted(
      emit("user", { ...body, ...(text !== undefined && INJECTED_USER.test(text) ? { injected: true } : {}) }),
      text ? { text } : {}
    );
  }
  return emitted(emit(role === "assistant" ? "assistant" : "system", body), text ? { text } : {});
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

/** `metadata.exit_code` of a JSON output, read through the schema of that output object. */
const ExitCodeOutput = z.looseObject({ metadata: lenient(z.looseObject({ exit_code: lenient(z.number()) })) });

/** `metadata.exit_code` of a JSON output, else the `Exit code:` header line in the lines before `Output:`. */
function exitCodeOf(output: unknown): number | undefined {
  if (typeof output !== "string") {
    return undefined;
  }
  if (output.startsWith("{")) {
    try {
      const code = z.safeParse(ExitCodeOutput, JSON.parse(output)).data?.metadata?.exit_code;
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

function resultFlags(output: unknown): { isError?: boolean; exitCode?: number } {
  const exitCode = exitCodeOf(output);
  return exitCode === undefined ? {} : { exitCode, isError: exitCode !== 0 };
}

/**
 * Emits the event of one response item (`response_item.payload`, or a bare item of an older rollout). The caller
 * handles `compaction` items; any type not listed here becomes an `unknown` event.
 */
export function emitResponseItem(type: string, item: CodexPayloadValue, emit: EmitEvent): EmittedResponseItem {
  switch (type) {
    case "message":
      return emitMessage(item, emit);
    case "agent_message": {
      // A message between agents (`author` → `recipient`), not this model's own reply.
      const text = textFrom(item.content);
      return emitted(
        emit("system", {
          type: "agent_message",
          ...(item.author ? { author: item.author } : {}),
          ...(item.recipient ? { recipient: item.recipient } : {}),
          ...(text ? { text } : {})
        }),
        text ? { text } : {}
      );
    }
    case "reasoning": {
      const text = textFrom(item.summary);
      return emitted(emit("reasoning", text ? { text } : { redacted: true }), text ? { text } : {});
    }
    case "web_search_call": {
      const callId = item.call_id ?? item.id ?? "";
      return emitted(
        emit("tool_call", {
          callId,
          name: "web_search",
          ...(item.action === undefined ? {} : { args: item.action })
        }),
        { callId }
      );
    }
    case "tool_search_call": {
      const callId = item.call_id ?? "";
      return emitted(
        emit("tool_call", {
          callId,
          name: "tool_search",
          ...(item.arguments === undefined ? {} : { args: item.arguments })
        }),
        { callId }
      );
    }
    case "tool_search_output": {
      const status = item.status;
      // A tool search's result payload is the `tools` list, not an `output`.
      const body = {
        callId: item.call_id ?? "",
        ...(item.tools === undefined ? {} : { output: item.tools }),
        ...(status === "failed" || status === "error" ? { isError: true } : {})
      };
      return emitted(emit("tool_result", body), {
        callId: body.callId,
        ...(body.output === undefined ? {} : { output: body.output })
      });
    }
    case "function_call":
    case "custom_tool_call": {
      const callId = item.call_id ?? "";
      const args = item.arguments ?? item.input;
      return emitted(
        emit("tool_call", {
          callId,
          name: item.name ?? "",
          ...(args === undefined ? {} : { args: argsOf(args) })
        }),
        { callId }
      );
    }
    case "function_call_output":
    case "custom_tool_call_output": {
      const body = {
        callId: item.call_id ?? "",
        ...resultFlags(item.output),
        ...(item.output === undefined ? {} : { output: item.output })
      };
      return emitted(emit("tool_result", body), {
        callId: body.callId,
        ...(item.output === undefined ? {} : { output: item.output })
      });
    }
    default:
      return emitted(emit("unknown", { type }));
  }
}
