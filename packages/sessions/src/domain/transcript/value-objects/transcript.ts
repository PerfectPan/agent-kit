import type { CodingAgentId } from "@rivus/agent-kit-catalog";

import type { SessionPrompt, SessionPromptsOptions, SessionSummary } from "../../session/index.js";
import { shadowedIn } from "../policies/compaction-shadowing.js";
import { mainAgentId, promptStarts, sessionPrompts } from "../policies/turns.js";
import { foldTranscript } from "../services/fold-transcript.js";
import type { SkippedRecord } from "./source-pointer.js";
import type { TranscriptEvent } from "./transcript-event.js";
import type { Capability, Lane, TranscriptSession, TranscriptSnapshot } from "./transcript-snapshot.js";

/**
 * A transcript in memory: the snapshot's fields plus the operations over the whole transcript. Each method gives what
 * the function of its rule gives for the snapshot. The model shares the snapshot's arrays and keeps no state of its
 * own; a top-level field reassigned on the snapshot after `restoreTranscript` is not seen.
 */
export interface Transcript extends Readonly<TranscriptSnapshot> {
  /** `foldTranscript` of this transcript. */
  summarize(): SessionSummary;
  /** `sessionPrompts` of this transcript under the given caps. */
  prompts(options: SessionPromptsOptions): SessionPrompt[];
  /** `mainAgentId` of this transcript. */
  mainAgentId(): string;
  /** `promptStarts` of this transcript, on one lane or on all. */
  promptStarts(lane?: string): TranscriptEvent[];
  /** `shadowedIn` of this transcript's events. */
  shadowed(): Set<string>;
  /** The snapshot this model was restored from, the same object. */
  toSnapshot(): TranscriptSnapshot;
}

class TranscriptValue implements Transcript {
  // `declare`: under ES2022 class fields a plain declaration creates an own `undefined` property, and a snapshot
  // without `agentVersion` would gain that key when it is cloned or serialized.
  declare readonly agent: CodingAgentId;
  declare readonly agentVersion?: string;
  declare readonly session: TranscriptSession;
  declare readonly capabilities: Capability[];
  declare readonly agents: Lane[];
  declare readonly events: TranscriptEvent[];
  declare readonly skipped: SkippedRecord[];
  readonly #snapshot: TranscriptSnapshot;

  private constructor(snapshot: TranscriptSnapshot) {
    Object.assign(this, snapshot);
    this.#snapshot = snapshot;
    Object.freeze(this);
  }

  static restore(snapshot: TranscriptSnapshot): Transcript {
    return new TranscriptValue(snapshot);
  }

  summarize(): SessionSummary {
    return foldTranscript(this);
  }

  prompts(options: SessionPromptsOptions): SessionPrompt[] {
    return sessionPrompts(this, options);
  }

  mainAgentId(): string {
    return mainAgentId(this);
  }

  promptStarts(lane?: string): TranscriptEvent[] {
    return promptStarts(this, lane);
  }

  shadowed(): Set<string> {
    return shadowedIn(this.events);
  }

  toSnapshot(): TranscriptSnapshot {
    return this.#snapshot;
  }
}

/**
 * The model of a snapshot from `loadTranscript`, a translator, or a copy of one. The snapshot is not validated or
 * copied: the adapters guarantee its invariants, and the model shares its arrays.
 */
export function restoreTranscript(snapshot: TranscriptSnapshot): Transcript {
  return TranscriptValue.restore(snapshot);
}
