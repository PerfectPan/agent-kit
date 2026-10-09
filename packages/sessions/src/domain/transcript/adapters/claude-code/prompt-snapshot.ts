import * as z from "zod/mini";

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
} from "../../index.js";
import { lenient } from "../lenient.js";
import type { ClaudeCodeAttachment } from "./record.js";

/** Blocks of a recorded `systemPrompt` array are joined with a blank line; the original keeps the blocks. */
const BLOCK_SEPARATOR = "\n\n";

/**
 * The fields of a recognized `prompt_snapshot` attachment. Unlike the record's lenient fields, a `systemPrompt`
 * or `tools` of another shape is an unknown format generation, so these parse strictly; `cliPrefix` stays
 * lenient, where a wrong type counts as absent.
 */
const PromptSnapshotAttachment = z.object({
  systemPrompt: z.optional(z.union([z.string(), z.array(z.string())])),
  tools: z.optional(z.array(z.unknown())),
  cliPrefix: lenient(z.string())
});

/**
 * The payload of an `attachment.type: 'prompt_snapshot'` record (Claude Code 2.1.268 and later): the system prompt
 * the CLI sent, as a string array, and on some snapshots the tool list and `cliPrefix`. `undefined` when a strict
 * field has another shape, which is an unknown format generation.
 */
export function promptSnapshotPayload(attachment: ClaudeCodeAttachment): Record<string, unknown> | undefined {
  const snapshot = z.safeParse(PromptSnapshotAttachment, attachment).data;
  if (!snapshot) {
    return undefined;
  }
  const payload: Record<string, unknown> = { type: "prompt_snapshot" };
  const prompt = snapshot.systemPrompt;
  if (typeof prompt === "string") {
    if (prompt) {
      payload.systemPrompt = prompt;
    }
  } else if (prompt !== undefined) {
    const text = prompt.join(BLOCK_SEPARATOR);
    if (text) {
      payload.systemPrompt = text;
    }
  }
  if (snapshot.tools !== undefined) {
    payload.tools = snapshot.tools;
  }
  if (snapshot.cliPrefix) {
    payload.cliPrefix = snapshot.cliPrefix;
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
