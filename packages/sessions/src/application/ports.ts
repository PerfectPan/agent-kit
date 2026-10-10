import type { AgentHome, CodingAgentId, HomeRule, Result } from "@rivus/agent-kit-catalog";
import type { PlatformFs } from "@rivus/agent-kit-platform";

import type {
  ReadFailed,
  SessionHead,
  SessionListFailure,
  SessionNotFound,
  SessionPromptsOptions,
  SessionRef,
  SessionSummaryWithPrompts
} from "../domain/session/index.js";
import type { Capability, Transcript, UnknownFormatGeneration } from "../domain/transcript/index.js";

/**
 * The part of Platform that reading sessions uses: listing, stat and reads, never writes. A whole Platform
 * satisfies it, and so does a read-only file system such as a browser's.
 */
export interface SessionPlatform {
  readonly fs: Pick<PlatformFs, "stat" | "list" | "read">;
}

export interface DiscoverOptions {
  readonly signal?: AbortSignal;
  /** Called once with the number of session files under the root, before their heads are read. */
  readonly onTotal?: (files: number) => void;
}

export interface LoadOptions {
  readonly signal?: AbortSignal;
  /** Called with the running total of bytes read across the session's files. */
  readonly onProgress?: (bytes: number) => void;
}

/**
 * How one CodingAgent stores its sessions and how to read them. Built-in adapters are in `builtinSessionAdapters`;
 * a caller passes its own through the `adapters` option of a use case, and `/testing` has the conformance checks an
 * adapter must pass. Every read goes through the platform passed to the call.
 */
export interface SessionAdapter {
  readonly specificationVersion: "sessions-v1";
  readonly agent: CodingAgentId;
  readonly displayName: string;
  /** Everything this agent's transcripts can list; each transcript lists the subset its files show. */
  readonly capabilities: readonly Capability[];
  /** This agent's home rule, used instead of catalog's; required for an agent catalog has no rule for. */
  readonly home?: HomeRule;
  /** Directories that hold this agent's sessions, such as `<home>/projects`. */
  roots(home: AgentHome): string[];
  /** Lists the sessions under `root`, reading at most 64 KB from each end of each file. */
  discover(
    platform: SessionPlatform,
    root: string,
    options?: DiscoverOptions
  ): AsyncIterable<SessionHead | SessionListFailure>;
  /** Whether `ref.path` is a session of this agent; cheap, for refs whose agent is unknown. */
  detect(platform: SessionPlatform, ref: SessionRef): Promise<boolean>;
  /**
   * Reads every file of the session. Expected failures are values: a file that disappeared, an IO error, or a format
   * generation this adapter does not know; single unreadable lines are skipped records. An abort rejects with
   * `signal.reason`, and only defects throw.
   */
  load(
    platform: SessionPlatform,
    ref: SessionRef,
    options?: LoadOptions
  ): Promise<Result<Transcript, SessionReadError>>;
  /**
   * A faster pass than folding the loaded transcript, with the same result: no transcript or event payload is kept,
   * and the state it holds grows with the session's requests, lanes and tool calls, never with its bytes. With
   * `prompts`, the summary also carries the main lane's user prompts under the given caps, by the same rule
   * `sessionPrompts` applies to the loaded transcript — an implementation that leaves them out fails the conformance
   * suite.
   */
  summarize?(
    platform: SessionPlatform,
    ref: SessionRef,
    options?: { readonly signal?: AbortSignal; readonly prompts?: SessionPromptsOptions }
  ): Promise<Result<SessionSummaryWithPrompts, SessionReadError>>;
}

/** The expected failures of reading one session's files. */
export type SessionReadError = SessionNotFound | ReadFailed | UnknownFormatGeneration;

/** Session adapters by agent id; use cases default to `builtinSessionAdapters`. */
export type SessionAdapters = Readonly<Partial<Record<CodingAgentId, SessionAdapter>>>;
