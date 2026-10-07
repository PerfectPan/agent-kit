import type { CodingAgentId } from "@rivus/agent-kit-catalog";

import { basenamePath } from "../../session/index.js";
import { type SkippedRecord, type SourcedRecord, sourceOf } from "../value-objects/source-pointer.js";
import type { TranscriptEvent, TranscriptEventKind } from "../value-objects/transcript-event.js";
import type { Capability, Lane, Transcript, TranscriptSession } from "../value-objects/transcript.js";

/** What a translation produces before the adapter adds the agent id and the capabilities its files show. */
export interface ParsedTranscript {
  events: TranscriptEvent[];
  skipped: SkippedRecord[];
  session: TranscriptSession;
  agentVersion?: string;
  agents: Lane[];
}

export function createTranscript(
  agent: CodingAgentId,
  capabilities: readonly Capability[],
  parsed: ParsedTranscript
): Transcript {
  return {
    agent,
    ...(parsed.agentVersion === undefined ? {} : { agentVersion: parsed.agentVersion }),
    session: parsed.session,
    capabilities: [...capabilities],
    agents: parsed.agents,
    events: parsed.events,
    skipped: parsed.skipped
  };
}

/** `<file name>:<line>`, plus `:<part>` for the second and later events of one record. Stable across loads. */
export function lineId(record: SourcedRecord, part = 0): string {
  const base = basenamePath(record.file);
  return part === 0 ? `${base}:${record.line}` : `${base}:${record.line}:${part}`;
}

export interface EventFields {
  id?: string;
  ts?: number;
  agentId?: string;
  parentId?: string;
  requestId?: string;
}

/** An event for `record` with `seq` 0; `assignSeq` numbers the finished list. */
export function baseEvent(
  record: SourcedRecord,
  kind: TranscriptEventKind,
  payload: Record<string, unknown>,
  fields: EventFields = {}
): TranscriptEvent {
  const event: TranscriptEvent = {
    id: fields.id ?? lineId(record),
    seq: 0,
    ts: fields.ts ?? 0,
    kind,
    payload,
    source: sourceOf(record),
    original: record.value
  };
  if (fields.agentId) {
    event.agentId = fields.agentId;
  }
  if (fields.parentId) {
    event.parentId = fields.parentId;
  }
  if (fields.requestId) {
    event.requestId = fields.requestId;
  }
  return event;
}

export function skipRecord(skipped: SkippedRecord[], record: SourcedRecord, reason: string): void {
  skipped.push({ reason, source: sourceOf(record) });
}
