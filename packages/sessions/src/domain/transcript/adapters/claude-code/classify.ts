import { type TranscriptEventKind } from "../../index.js";
import { type ClaudeCodeAttachment, type ClaudeCodeContentBlockValue, type ClaudeCodeRecordValue } from "./record.js";
import { promptSnapshotPayload } from "./prompt-snapshot.js";
import { type ClaudeCodeUserFlags, isPromptFlags, recordText, userFlags } from "./user-flags.js";
import { claudeCodeRequestKey } from "../../../usage/adapters/claude-code.js";

/** Record types that only the CLI reads. Each becomes a skipped record with its type as the reason. */
const BOOKKEEPING = new Set([
  "file-history-snapshot",
  "file-history-delta",
  "cost-state",
  "last-prompt",
  "atis-latch",
  "mode",
  "permission-mode",
  "queue-operation",
  "relocated",
  "worktree-state",
  "fork-context-ref",
  "pr-link",
  "frame-link"
]);

/** One event a record becomes: the kind and the payload `baseEvent` stores. */
export interface ClaudeCodeEventPart {
  kind: TranscriptEventKind;
  payload: Record<string, unknown>;
}

/**
 * What one parsed record becomes, shared by the translation and the summarize pass so a record type changes both:
 * the events it emits (kind and payload, in order), the request it belongs to, the title it carries, or why it
 * becomes no event. A prompt snapshot whose strict parse fails is an unknown format generation.
 */
export type ClaudeCodeRecordParts =
  | { generationError: true }
  | {
      generationError: false;
      /** The events the record emits, in order; empty when the record is skipped. */
      events: readonly ClaudeCodeEventPart[];
      /** The request the record belongs to, when it names one. An empty key is dropped, as `baseEvent` drops it. */
      requestKey?: string;
      /** The title text of a user record that is a real prompt, when it carries one. */
      promptTitle?: string;
      /** The title a `custom-title`, `ai-title` or `summary` record carries, and whether it is explicit. */
      title?: { text: string; explicit: boolean };
      /** Why the record became no event, as the translation's skipped records report it. */
      skip?: string;
    };

function blockEvent(
  role: "user" | "assistant",
  flags: ClaudeCodeUserFlags,
  item: ClaudeCodeContentBlockValue | undefined
): ClaudeCodeEventPart {
  const blockType = item?.type;
  if (!item || !blockType) {
    return { kind: "unknown", payload: { type: "block" } };
  }
  switch (blockType) {
    case "text": {
      const text = item.text ?? "";
      return { kind: role, payload: { ...flags, ...(text ? { text } : {}) } };
    }
    case "image": {
      const mediaType = item.source?.media_type;
      return { kind: role, payload: { ...flags, image: true, ...(mediaType ? { mediaType } : {}) } };
    }
    case "fallback": {
      // The response switched models mid-stream (`from.model` → `to.model`).
      const from = item.from?.model;
      const to = item.to?.model;
      return {
        kind: "system",
        payload: { type: "fallback", ...(from ? { fromModel: from } : {}), ...(to ? { toModel: to } : {}) }
      };
    }
    case "thinking":
    case "redacted_thinking": {
      const text = item.thinking;
      return { kind: "reasoning", payload: text ? { text } : { redacted: true } };
    }
    case "tool_use":
      return {
        kind: "tool_call",
        payload: {
          callId: item.id ?? "",
          name: item.name ?? "",
          ...(item.input === undefined ? {} : { args: item.input })
        }
      };
    case "tool_result":
      return {
        kind: "tool_result",
        payload: {
          callId: item.tool_use_id ?? "",
          ...(item.content === undefined ? {} : { output: item.content }),
          ...(item.is_error === undefined ? {} : { isError: item.is_error })
        }
      };
    default:
      return { kind: "unknown", payload: { type: blockType } };
  }
}

function systemEvent(rec: ClaudeCodeRecordValue): ClaudeCodeEventPart {
  const subtype = rec.subtype ?? "system";
  if (subtype === "compact_boundary") {
    const trigger = rec.compactMetadata?.trigger;
    const preTokens = rec.compactMetadata?.preTokens;
    const postTokens = rec.compactMetadata?.postTokens;
    return {
      kind: "compaction",
      payload: {
        ...(trigger === "auto" || trigger === "manual" ? { trigger } : {}),
        ...(preTokens === undefined ? {} : { preTokens }),
        ...(postTokens === undefined ? {} : { postTokens })
      }
    };
  }
  if (subtype === "turn_duration") {
    const durationMs = rec.durationMs;
    return { kind: "system", payload: { type: "turn_duration", ...(durationMs === undefined ? {} : { durationMs }) } };
  }
  if (subtype.includes("hook")) {
    return { kind: "hook", payload: { type: subtype } };
  }
  const text = rec.content;
  const payload: Record<string, unknown> = { type: subtype, ...(text ? { text } : {}) };
  // `model_refusal_fallback` / `model_refusal_no_fallback`: the API refused and the CLI retried on another model, or did not.
  for (const key of ["originalModel", "fallbackModel", "apiRefusalCategory"] as const) {
    const value = rec[key];
    if (value) {
      payload[key] = value;
    }
  }
  return { kind: "system", payload };
}

function hookPayload(type: string, attachment: ClaudeCodeAttachment | undefined): Record<string, unknown> {
  const name = attachment?.hookName;
  const event = attachment?.hookEvent;
  const exitCode = attachment?.exitCode;
  return {
    type,
    ...(name ? { name } : {}),
    ...(event ? { event } : {}),
    ...(exitCode === undefined ? {} : { exitCode })
  };
}

export function classifyClaudeCodeRecord(rec: ClaudeCodeRecordValue): ClaudeCodeRecordParts {
  const type = rec.type;
  if (type === "user" || type === "assistant") {
    const requestId = claudeCodeRequestKey(rec);
    const flags: ClaudeCodeUserFlags = type === "user" ? userFlags(rec) : {};
    const content = rec.message?.content;
    const parts: ClaudeCodeEventPart[] = [];
    if (typeof content === "string") {
      parts.push({ kind: type, payload: { ...flags, ...(content ? { text: content } : {}) } });
    } else if (!Array.isArray(content) || content.length === 0) {
      parts.push({ kind: type, payload: { ...flags } });
    } else {
      for (const block of content) {
        parts.push(blockEvent(type, flags, block));
      }
    }
    const text = type === "user" && isPromptFlags(flags) ? recordText(rec) : undefined;
    return {
      generationError: false,
      events: parts,
      ...(requestId ? { requestKey: requestId } : {}),
      ...(text ? { promptTitle: text } : {})
    };
  }

  if (type === "system") {
    return { generationError: false, events: [systemEvent(rec)] };
  }

  if (type === "attachment") {
    const attachment = rec.attachment;
    const attachmentType = attachment?.type ?? "";
    if (attachment && attachmentType === "prompt_snapshot") {
      const payload = promptSnapshotPayload(attachment);
      if (!payload) {
        return { generationError: true };
      }
      return { generationError: false, events: [{ kind: "system", payload }] };
    }
    if (attachmentType.startsWith("hook_")) {
      return { generationError: false, events: [{ kind: "hook", payload: hookPayload(attachmentType, attachment) }] };
    }
    return { generationError: false, events: [], skip: `attachment:${attachmentType || "record"}` };
  }

  if (type === "custom-title") {
    return {
      generationError: false,
      events: [],
      skip: "custom-title",
      ...(rec.customTitle ? { title: { text: rec.customTitle, explicit: true } } : {})
    };
  }
  if (type === "ai-title" || type === "summary") {
    const text = rec.aiTitle ?? rec.summary ?? rec.title;
    return {
      generationError: false,
      events: [],
      skip: type,
      ...(text ? { title: { text, explicit: false } } : {})
    };
  }
  if (BOOKKEEPING.has(type)) {
    return { generationError: false, events: [], skip: type };
  }
  return { generationError: false, events: [{ kind: "unknown", payload: { type } }] };
}
