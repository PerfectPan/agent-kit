import {
  AgentKitError,
  type CapabilityUnsupported,
  type CodingAgentId,
  type Result,
  lookupService,
  err,
  ok,
  parseCodingAgentId
} from "@rivus/agent-kit-catalog/public";

import type { NoAdapterAccepted } from "../../domain/session/errors/session-read-error.js";
import type {
  SessionPromptsOptions,
  SessionSummaryWithPrompts
} from "../../domain/session/value-objects/session-summary.js";
import type { SessionRef } from "../../domain/session/value-objects/session-ref.js";
import { foldTranscript, summaryOf } from "../../domain/transcript/services/fold-transcript.js";
import { sessionPrompts } from "../../domain/transcript/services/turns.js";
import { type Transcript } from "../../domain/transcript/value-objects/transcript.js";
import { catchIoFailure } from "../services/files/io-failure.js";
import type { SessionAdapter, SessionPlatform, SessionReadError } from "../spi.js";
import type { SessionProviders } from "../providers.js";

/** A session to read. Without an `agent` (or with an id that does not parse), every adapter's `detect` decides. */
export interface SessionTarget {
  readonly agent?: CodingAgentId;
  readonly path: string;
  readonly sessionId?: string;
}

export interface LoadTranscriptOptions {
  readonly providers: SessionProviders;
  readonly signal?: AbortSignal;
  /** Called with the running total of bytes read across the session's files. */
  readonly onProgress?: (bytes: number) => void;
}

/** The expected failures of `loadTranscript` and `summarizeSession`. */
export type LoadTranscriptError = SessionReadError | NoAdapterAccepted | CapabilityUnsupported;

async function resolveTarget(
  platform: SessionPlatform,
  target: SessionTarget,
  options: LoadTranscriptOptions
): Promise<Result<{ adapter: SessionAdapter; ref: SessionRef }, LoadTranscriptError>> {
  const table = options.providers.sessions;
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
  const named = target.agent === undefined ? undefined : parseCodingAgentId(target.agent, options.providers.identity);
  if (named?.ok) {
    const found = lookupService(named.value, table);
    return found.ok ? ok({ adapter: found.value, ref: ref(found.value.agent) }) : found;
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

/**
 * Reads every file of a session into one Transcript. Expected failures are values: `SessionNotFound`,
 * `CapabilityUnsupported` (the named agent has no adapter), `NoAdapterAccepted` (detection found none),
 * `UnknownFormatGeneration` and `ReadFailed`. An abort rejects with `signal.reason`; only defects throw.
 */
export async function loadTranscript(
  platform: SessionPlatform,
  target: SessionTarget,
  options: LoadTranscriptOptions
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

/** The user prompts a caller asked a summary pass to collect, with the caps they carry. */
function promptsOption(options: { readonly prompts?: SessionPromptsOptions }): SessionPromptsOptions | undefined {
  const rejected = (): AgentKitError =>
    new AgentKitError(
      "invalid-prompts",
      `prompts.limit must be a non-negative integer and prompts.maxChars a positive integer, got ${JSON.stringify(options.prompts)}`
    );
  // A JS caller can pass `null`, or any other value, where the type says the option is absent.
  const prompts: unknown = options.prompts;
  if (prompts === null) {
    throw rejected();
  }
  if (prompts === undefined) {
    return undefined;
  }
  const { limit, maxChars } = prompts as SessionPromptsOptions;
  if (!Number.isInteger(limit) || limit < 0 || !Number.isInteger(maxChars) || maxChars < 1) {
    throw rejected();
  }
  return { limit, maxChars };
}

/**
 * The adapter's own summary pass when it has one, else `foldTranscript` of the loaded transcript — the same numbers
 * either way, so a cache of summaries cannot tell them apart. With `prompts`, the summary also carries the main
 * lane's user prompts: from the pass for an adapter that implements one, else from the loaded transcript, always by
 * the kit's prompt rule (`sessionPrompts`).
 */
export async function summarizeSession(
  platform: SessionPlatform,
  target: SessionTarget,
  options: Omit<LoadTranscriptOptions, "onProgress"> & { readonly prompts?: SessionPromptsOptions }
): Promise<Result<SessionSummaryWithPrompts, LoadTranscriptError>> {
  const prompts = promptsOption(options);
  const resolved = await resolveTarget(platform, target, options);
  if (!resolved.ok) {
    options.signal?.throwIfAborted();
    return resolved;
  }
  const { adapter, ref } = resolved.value;
  const signal = options.signal ? { signal: options.signal } : {};
  const asked = prompts === undefined ? signal : { ...signal, prompts };
  if (adapter.summarize) {
    const summary = await adapter.summarize(platform, ref, asked);
    options.signal?.throwIfAborted();
    return summary.ok ? ok(summaryOf(summary.value)) : summary;
  }
  const transcript = await adapter.load(platform, ref, signal);
  options.signal?.throwIfAborted();
  if (!transcript.ok) {
    return transcript;
  }
  const summary = foldTranscript(transcript.value);
  return ok(prompts === undefined ? summary : { ...summary, prompts: sessionPrompts(transcript.value, prompts) });
}
