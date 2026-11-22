import type { Result } from "@rivus/agent-kit-catalog/public";
import type { UnknownFormatGeneration } from "../errors/unknown-format-generation.js";
import { definedFields } from "@rivus/agent-kit-catalog/public";
import { baseEvent, lineId, type ParsedTranscript } from "../factories/transcript-event.js";
import type { SourcedRecord } from "../value-objects/source-pointer.js";
import type { TranscriptSession } from "../value-objects/transcript.js";
import type { TranscriptEvent, TranscriptEventBody } from "../value-objects/transcript-event.js";
import { assignSeq, inheritTimes } from "./event-ordering.js";
import { markOrphanToolResults } from "./tool-result-pairing.js";
import { MAIN_LANE_ID } from "./turns.js";

/** One agent's records into transcript events: `step` per record in order, then `finish` once. */
export interface RecordTranslation {
  /** Every event, in file order; empty when the translation retains none. */
  readonly events: TranscriptEvent[];
  /** Records that produced no event, with the reason. */
  readonly skipped: { reason: string; record: SourcedRecord }[];
  /** Translates one record; `ts` is the inherited time the events take. */
  readonly step: (record: SourcedRecord, ts: number) => Result<readonly TranscriptEvent[], UnknownFormatGeneration>;
  /** The finished transcript; call once after the last `step`. */
  readonly finish: () => ParsedTranscript;
}

/** Shared event/skip accumulator for streaming session translations (load and summarize passes). */
export interface TranslationBuffer {
  readonly events: TranscriptEvent[];
  readonly skipped: { reason: string; record: SourcedRecord }[];
  readonly noteTime: (ts: number) => void;
  readonly beginStep: () => TranscriptEvent[];
  readonly emit: (event: TranscriptEvent) => TranscriptEvent;
  readonly skip: (record: SourcedRecord, reason: string) => void;
  /** The session of the records so far: its identity, the time bounds `noteTime` saw, and `extra` fields. */
  readonly session: (
    identity: { readonly id?: string; readonly fallbackId?: string; readonly title?: string; readonly cwd?: string },
    extra?: Partial<TranscriptSession>
  ) => TranscriptSession;
  readonly finish: (session: TranscriptSession, beforeFinalize?: () => void) => ParsedTranscript;
}

/** Creates a buffer that retains events/skips when `retain` is true and tracks step-local parts and time bounds. */
export function createTranslationBuffer(retain: boolean): TranslationBuffer {
  const events: TranscriptEvent[] = [];
  const skipped: { reason: string; record: SourcedRecord }[] = [];
  let startedAt: number | undefined;
  let endedAt: number | undefined;
  let stepParts: TranscriptEvent[] | undefined;

  return {
    events,
    skipped,
    noteTime(ts) {
      startedAt = startedAt === undefined ? ts : Math.min(startedAt, ts);
      endedAt = endedAt === undefined ? ts : Math.max(endedAt, ts);
    },
    beginStep() {
      const parts: TranscriptEvent[] = [];
      stepParts = parts;
      return parts;
    },
    emit(event) {
      if (retain) {
        events.push(event);
      }
      stepParts?.push(event);
      return event;
    },
    skip(record, reason) {
      if (retain) {
        skipped.push({ reason, record });
      }
    },
    session(identity, extra = {}) {
      return {
        id: identity.id ?? identity.fallbackId ?? "unknown",
        ...(identity.title === undefined ? {} : { title: identity.title }),
        ...(identity.cwd === undefined ? {} : { cwd: identity.cwd }),
        ...(startedAt === undefined ? {} : { startedAt }),
        ...(endedAt === undefined ? {} : { endedAt }),
        ...extra
      };
    },
    finish(session, beforeFinalize) {
      if (retain) {
        beforeFinalize?.();
        markOrphanToolResults(events);
        assignSeq(events);
      }
      return {
        events,
        skipped: skipped.map(({ reason, record }) => ({ reason, source: record })),
        session,
        agents: [{ id: MAIN_LANE_ID }]
      };
    }
  };
}

/** Joins the `text` fields of all `{ kind: "text" }` content parts with newlines. */
export function joinedPartText(parts: readonly { readonly kind: string; readonly text?: string }[]): string {
  return parts
    .filter(
      (part): part is { readonly kind: "text"; readonly text: string } =>
        part.kind === "text" && part.text !== undefined
    )
    .map((part) => part.text)
    .join("\n");
}

/** Pushes a new event onto `events` when `retain` is true, returning the created event or `undefined`. */
export function pushRetainedEvent(
  events: TranscriptEvent[],
  retain: boolean,
  record: SourcedRecord,
  partIndex: number,
  body: TranscriptEventBody,
  extra: { readonly ts: number; readonly requestId?: string; readonly agentId?: string }
): TranscriptEvent | undefined {
  if (!retain) {
    return undefined;
  }
  const event = baseEvent(
    record,
    body.kind,
    body.payload,
    definedFields({ id: lineId(record, partIndex), ts: extra.ts, requestId: extra.requestId, agentId: extra.agentId })
  );
  events.push(event);
  return event;
}

/** Inherits missing timestamps, marks orphan tool results, and assigns sequence numbers in-place. */
export function finalizeTranscriptEvents(events: TranscriptEvent[]): void {
  const times = inheritTimes(events.map((event) => (event.ts > 0 ? event.ts : undefined)));
  for (const [index, event] of events.entries()) {
    event.ts = times[index]!;
  }
  markOrphanToolResults(events);
  assignSeq(events);
}

/** The first id of `base`'s shape not in `used`: `base` itself, then `base:1`, `base:2`, … */
export function nextFreeId(used: ReadonlySet<string>, base: string): string {
  let candidate = base;
  for (let serial = 1; used.has(candidate); serial += 1) {
    candidate = `${base}:${serial}`;
  }
  return candidate;
}
