import type { Usage } from "../../usage/index.js";
import type { TranscriptEvent, TranscriptEventKind } from "./transcript-event.js";

/**
 * A TranscriptEvent of a live turn. It has no `source`: a live update is not stored in a file the kit can point back
 * to. `original` holds the update when the event comes from one update.
 */
export type LiveTranscriptEvent = Omit<TranscriptEvent, "source">;

/**
 * One part of a live turn's stream. The deltas are named after AI SDK's UI message stream parts: text and reasoning
 * arrive as `*-start`, `*-delta`, `*-end` with a shared `id`; a tool call as `tool-input-start`, then
 * `tool-input-available` whenever its input is known or changes, then `tool-output-available` once it has completed
 * or `tool-output-error` once it has failed, with `errorText` for display and the output the agent gave, if any.
 * `update` is an update that becomes one event as it is, such as a plan or a mode change. `finish` ends the turn.
 * `event` carries a completed event; `foldStreamParts` produces the same events from the other parts.
 */
export type TranscriptStreamPart =
  | { readonly type: "text-start"; readonly id: string }
  | { readonly type: "text-delta"; readonly id: string; readonly delta: string }
  | { readonly type: "text-end"; readonly id: string }
  | { readonly type: "reasoning-start"; readonly id: string }
  | { readonly type: "reasoning-delta"; readonly id: string; readonly delta: string }
  | { readonly type: "reasoning-end"; readonly id: string }
  | { readonly type: "tool-input-start"; readonly toolCallId: string; readonly toolName: string }
  | {
      readonly type: "tool-input-available";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly input: unknown;
    }
  | { readonly type: "tool-output-available"; readonly toolCallId: string; readonly output?: unknown }
  | {
      readonly type: "tool-output-error";
      readonly toolCallId: string;
      readonly errorText: string;
      readonly output?: unknown;
    }
  | {
      readonly type: "update";
      readonly id: string;
      readonly kind: TranscriptEventKind;
      readonly payload: Readonly<Record<string, unknown>>;
      readonly original?: unknown;
    }
  | { readonly type: "finish"; readonly id: string; readonly finishReason: string; readonly usage?: Usage }
  | { readonly type: "event"; readonly event: LiveTranscriptEvent };
