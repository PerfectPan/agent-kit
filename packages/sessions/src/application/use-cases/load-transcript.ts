import { type CodingAgentId, err, ok, parseCodingAgentId, type Result } from "@rivus/agent-kit-catalog";

import type {
  CapabilityUnsupported,
  NoAdapterAccepted,
  SessionRef,
  SessionSummary
} from "../../domain/session/index.js";
import { foldTranscript, summaryOf, type Transcript } from "../../domain/transcript/index.js";
import { catchIoFailure } from "../services/files/io-failure.js";
import type { SessionAdapter, SessionAdapters, SessionPlatform, SessionReadError } from "../ports.js";
import { builtinSessionAdapters } from "../services/session-adapters/index.js";

/** A session to read. Without an `agent` (or with an id that does not parse), every adapter's `detect` decides. */
export interface SessionTarget {
  readonly agent?: CodingAgentId;
  readonly path: string;
  readonly sessionId?: string;
}

export interface LoadTranscriptOptions {
  /** Replaces `builtinSessionAdapters` for this call; spread it to extend it. */
  readonly adapters?: SessionAdapters;
  readonly signal?: AbortSignal;
  /** Called with the running total of bytes read across the session's files. */
  readonly onProgress?: (bytes: number) => void;
}

/** The expected failures of `loadTranscript` and `summarizeSession`. */
export type LoadTranscriptError = SessionReadError | NoAdapterAccepted | CapabilityUnsupported;

/**
 * Reads every file of a session into one Transcript. Expected failures are values: `SessionNotFound`,
 * `CapabilityUnsupported` (the named agent has no adapter), `NoAdapterAccepted` (detection found none),
 * `UnknownFormatGeneration` and `ReadFailed`. An abort rejects with `signal.reason`; only defects throw.
 */
export async function loadTranscript(
  platform: SessionPlatform,
  target: SessionTarget,
  options: LoadTranscriptOptions = {}
): Promise<Result<Transcript, LoadTranscriptError>> {
  const resolved = await resolveTarget(platform, target, options);
  if (!resolved.ok) {
    options.signal?.throwIfAborted();
    return resolved;
  }
  const { adapter, ref } = resolved.value;
  const transcript = await adapter.load(platform, ref, {
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {})
  });
  options.signal?.throwIfAborted();
  return transcript;
}

/** The adapter's own summary pass when it has one, else `foldTranscript` of the loaded transcript. */
export async function summarizeSession(
  platform: SessionPlatform,
  target: SessionTarget,
  options: Omit<LoadTranscriptOptions, "onProgress"> = {}
): Promise<Result<SessionSummary, LoadTranscriptError>> {
  const resolved = await resolveTarget(platform, target, options);
  if (!resolved.ok) {
    options.signal?.throwIfAborted();
    return resolved;
  }
  const { adapter, ref } = resolved.value;
  const signal = options.signal ? { signal: options.signal } : {};
  if (adapter.summarize) {
    const summary = await adapter.summarize(platform, ref, signal);
    options.signal?.throwIfAborted();
    return summary.ok ? ok(summaryOf(summary.value)) : summary;
  }
  const transcript = await adapter.load(platform, ref, signal);
  options.signal?.throwIfAborted();
  return transcript.ok ? ok(foldTranscript(transcript.value)) : transcript;
}

async function resolveTarget(
  platform: SessionPlatform,
  target: SessionTarget,
  options: { readonly adapters?: SessionAdapters; readonly signal?: AbortSignal }
): Promise<Result<{ adapter: SessionAdapter; ref: SessionRef }, LoadTranscriptError>> {
  const table: SessionAdapters = options.adapters ?? builtinSessionAdapters;
  options.signal?.throwIfAborted();
  const info = await catchIoFailure(platform, target.path, options.signal, (guarded) =>
    guarded.fs.stat(target.path, { followSymlinks: true })
  );
  if (!info.ok) {
    return info;
  }
  if (info.value === undefined) {
    return err({ _tag: "SessionNotFound", path: target.path });
  }
  const ref = (agent: CodingAgentId): SessionRef => ({
    agent,
    path: target.path,
    ...(target.sessionId === undefined ? {} : { sessionId: target.sessionId })
  });
  const named = target.agent === undefined ? undefined : parseCodingAgentId(target.agent);
  if (named?.ok) {
    const adapter = table[named.value];
    return adapter
      ? ok({ adapter, ref: ref(adapter.agent) })
      : err({ _tag: "CapabilityUnsupported", agent: named.value });
  }
  for (const adapter of Object.values(table)) {
    options.signal?.throwIfAborted();
    if (!adapter) {
      continue;
    }
    const detected = await catchIoFailure(platform, target.path, options.signal, (guarded) =>
      adapter.detect(guarded, ref(adapter.agent))
    );
    options.signal?.throwIfAborted();
    if (!detected.ok) {
      return detected;
    }
    if (detected.value) {
      return ok({ adapter, ref: ref(adapter.agent) });
    }
  }
  return err({ _tag: "NoAdapterAccepted", path: target.path });
}
