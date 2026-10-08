import {
  type Capability,
  type Lane,
  latestSnapshot,
  MAIN_LANE_ID,
  promptSnapshot,
  snapshotHasSystemPrompt,
  snapshotHasTools,
  type TranscriptEvent,
  type TranscriptSession
} from "../../domain/transcript/index.js";
import { asString } from "../../protocols/record-fields.js";

/** Blocks of a recorded `systemPrompt` array are joined with a blank line; the original keeps the blocks. */
const BLOCK_SEPARATOR = "\n\n";

/**
 * The payload of an `attachment.type: 'prompt_snapshot'` record (Claude Code 2.1.268 and later): the system prompt
 * the CLI sent, as a string array, and on some snapshots the tool list and `cliPrefix`. `undefined` when a field has
 * another shape, which is an unknown format generation.
 */
export function promptSnapshotPayload(attachment: Record<string, unknown>): Record<string, unknown> | undefined {
  const payload: Record<string, unknown> = { type: "prompt_snapshot" };
  const prompt = attachment.systemPrompt;
  if (typeof prompt === "string") {
    if (prompt) {
      payload.systemPrompt = prompt;
    }
  } else if (Array.isArray(prompt) && prompt.every((block) => typeof block === "string")) {
    const text = prompt.join(BLOCK_SEPARATOR);
    if (text) {
      payload.systemPrompt = text;
    }
  } else if (prompt !== undefined) {
    return undefined;
  }
  if (Array.isArray(attachment.tools)) {
    payload.tools = attachment.tools;
  } else if (attachment.tools !== undefined) {
    return undefined;
  }
  const cliPrefix = asString(attachment.cliPrefix);
  if (cliPrefix) {
    payload.cliPrefix = cliPrefix;
  }
  return payload;
}

/**
 * Session and lane fields from the snapshots: the session's system prompt and tools come from the main lane's latest
 * snapshot that recorded each, a subagent's system prompt from its own lane's latest one.
 */
export function applySnapshots(
  events: readonly TranscriptEvent[],
  agents: readonly Lane[],
  session: TranscriptSession
): void {
  const byLane = new Map<string, TranscriptEvent[]>();
  for (const event of events) {
    if (promptSnapshot(event)) {
      const lane = event.agentId ?? MAIN_LANE_ID;
      byLane.set(lane, [...(byLane.get(lane) ?? []), event]);
    }
  }
  const main = byLane.get(MAIN_LANE_ID) ?? [];
  const system = latestSnapshot(main, snapshotHasSystemPrompt);
  if (system) {
    session.systemPrompt = promptSnapshot(system)!.systemPrompt!;
  }
  const tools = latestSnapshot(main, snapshotHasTools);
  if (tools) {
    session.tools = promptSnapshot(tools)!.tools;
  }
  for (const agent of agents) {
    if (agent.id === MAIN_LANE_ID) {
      continue;
    }
    const own = latestSnapshot(byLane.get(agent.id) ?? [], snapshotHasSystemPrompt);
    if (own) {
      agent.systemPrompt = promptSnapshot(own)!.systemPrompt!;
    }
  }
}

/** `systemPrompt` and `toolSchemas` when the files contain snapshots that record them. */
export function snapshotCapabilities(events: readonly TranscriptEvent[]): Capability[] {
  const out: Capability[] = [];
  if (latestSnapshot(events, snapshotHasSystemPrompt)) {
    out.push("systemPrompt");
  }
  if (latestSnapshot(events, snapshotHasTools)) {
    out.push("toolSchemas");
  }
  return out;
}
