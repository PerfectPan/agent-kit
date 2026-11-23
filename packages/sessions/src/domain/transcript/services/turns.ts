import type {
  SessionPrompt,
  SessionPromptsOptions,
  SessionRequestUsage
} from "../../session/value-objects/session-summary.js";
import type { TranscriptEvent, TranscriptEventOf } from "../value-objects/transcript-event.js";
import type { Transcript } from "../value-objects/transcript.js";
import { PayloadText } from "../../../lib/payload-text.js";
import { definedFields } from "@rivus/agent-kit-catalog/public";

/** The lane id of the root agent when `agents` names none. */
export const MAIN_LANE_ID = "main";

/** The root lane: the first `agents` entry without a parent, else `main`. */
export function mainAgentId(transcript: Pick<Transcript, "agents">): string {
  return transcript.agents.find((agent) => agent.parentId === undefined)?.id ?? MAIN_LANE_ID;
}

/** The lane of one event. Events without `agentId` belong to the main agent. */
export function laneOf(event: TranscriptEvent, mainId: string): string {
  return event.agentId ?? mainId;
}

/** A real user prompt: a `user` event without any of the flags of `MessagePayload`. */
export function isPrompt(event: Pick<TranscriptEvent, "kind" | "payload">): boolean {
  if (event.kind !== "user") {
    return false;
  }
  const payload = event.payload;
  return !(
    payload.meta === true ||
    payload.compactSummary === true ||
    payload.command === true ||
    payload.injected === true ||
    payload.continued === true
  );
}

/** The agent record an event came from. Events from content blocks of one record share it. */
export function recordKey(event: TranscriptEvent): string {
  return `${event.source.file}\0${event.source.line}`;
}

/**
 * The events that start a turn, on one lane or on all: the first event of each prompt record, because several
 * content blocks of one record start one turn.
 */
export function promptStarts(transcript: Pick<Transcript, "agents" | "events">, lane?: string): TranscriptEvent[] {
  const mainId = mainAgentId(transcript);
  const seen = new Set<string>();
  const out: TranscriptEvent[] = [];
  for (const event of transcript.events) {
    if (!isPrompt(event)) {
      continue;
    }
    if (lane !== undefined && laneOf(event, mainId) !== lane) {
      continue;
    }
    const key = `${laneOf(event, mainId)}\0${recordKey(event)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(event);
  }
  return out;
}

/** What a price table bills for a `request` event: its recorded fields of `SessionRequestUsage`. */
export function requestUsage(event: Pick<TranscriptEventOf<"request">, "payload">): SessionRequestUsage {
  const { model, usage, granularity, modelCalls, usageByModel, pricingMultiplier } = event.payload;
  return definedFields({ model, usage, granularity, modelCalls, usageByModel, pricingMultiplier });
}

/**
 * The billed fields of every `request` event of a transcript, in event order: what a summary pass returns as
 * `requestUsage`, so a host can price a session it only summarized the way it prices the loaded transcript.
 */
export function sessionRequestUsage(transcript: Pick<Transcript, "events">): SessionRequestUsage[] {
  const out: SessionRequestUsage[] = [];
  for (const event of transcript.events) {
    if (event.kind === "request") {
      out.push(requestUsage(event));
    }
  }
  return out;
}

/**
 * Cap a prompt without keeping its source alive: in V8, split/join builds a flat string instead of retaining
 * slice's parent. UTF-16 code units, including a lone surrogate at the cut, stay unchanged.
 */
export function capPromptText(text: string, maxChars: number): string {
  return text.slice(0, maxChars).split("").join("");
}

/**
 * The main lane's user prompts, by the kit's prompt rule: one per prompt record, its text the record's event
 * texts, each trimmed, joined with a blank line; the first `limit` in transcript order, each capped at `maxChars`.
 * A prompt record without text, such as an image-only or a whitespace-only one, is a turn but yields no prompt; a
 * record the host filled entirely is injected and counts no turn.
 */
export function sessionPrompts(
  transcript: Pick<Transcript, "events" | "agents">,
  options: SessionPromptsOptions
): SessionPrompt[] {
  const mainId = mainAgentId(transcript);
  const parts = new Map<string, string[]>();
  for (const event of transcript.events) {
    if (!isPrompt(event) || laneOf(event, mainId) !== mainId) {
      continue;
    }
    const text = (PayloadText.safeParse(event.payload.text).data ?? "").trim();
    if (text === "") {
      continue;
    }
    const key = `${laneOf(event, mainId)}\0${recordKey(event)}`;
    const known = parts.get(key);
    if (known === undefined) {
      parts.set(key, [text]);
    } else {
      known.push(text);
    }
  }
  const prompts: SessionPrompt[] = [];
  for (const joined of parts.values()) {
    if (prompts.length >= options.limit) {
      break;
    }
    prompts.push({ text: capPromptText(joined.join("\n\n"), options.maxChars) });
  }
  return prompts;
}
