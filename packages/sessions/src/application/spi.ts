import type { ServiceTable } from "@rivus/agent-kit-catalog";
import type { AgentHome, CapabilityUnsupported, CodingAgentId, HomeRule, Result } from "@rivus/agent-kit-catalog";
import type { PlatformFs, PlatformSqlite } from "@rivus/agent-kit-platform";
import type {
  ReadFailed,
  SessionHead,
  SessionListError,
  SessionListFailure,
  SessionNotFound,
  SessionPromptsOptions,
  SessionRef,
  SessionSummaryWithPrompts
} from "../domain/session/index.js";
import type { Capability, SourceChanged, Transcript, UnknownFormatGeneration } from "../domain/transcript/index.js";
import type { UsageCursor, UsageRecord } from "../domain/usage/index.js";

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
   * suite. The equality covers the summary's numbers and prompts, not the failure modes: the pass may read fewer
   * files than `load` (side files the summary's numbers never read) and in its own order, so an IO error on one of
   * those can fail `load` while `summarize` succeeds, or the reverse.
   */
  summarize?(
    platform: SessionPlatform,
    ref: SessionRef,
    options?: { readonly signal?: AbortSignal; readonly prompts?: SessionPromptsOptions }
  ): Promise<Result<SessionSummaryWithPrompts, SessionReadError>>;
}

/** The expected failures of reading one session's files. */
export type SessionReadError = SessionNotFound | ReadFailed | UnknownFormatGeneration;

/** Session adapters by agent id; supplied by the caller. */
export type SessionAdapters = ServiceTable<SessionAdapter>;

export type { UsageCursor };

/** The part of Platform that decoding usage uses: file reads, and SQLite for an agent that keeps a database. */
export interface UsagePlatform extends SessionPlatform {
  readonly sqlite?: PlatformSqlite;
}

/** A file, directory or database that holds one agent's usage. */
export interface UsageSource {
  readonly agent: CodingAgentId;
  /**
   * What identifies the source within its agent and stays when the agent moves the file, such as a Codex rollout's
   * file name, which archiving keeps.
   */
  readonly id: string;
  readonly path: string;
  /** The last modification; for a database, of its write-ahead log when that is later. */
  readonly mtimeMs: number;
  /** Absent for a directory. */
  readonly sizeBytes?: number;
}

/** Why a root or a file could not be listed. Listing goes on with the next one. */
export interface UsageSourceFailure {
  readonly agent: CodingAgentId;
  readonly path: string;
  readonly error: SessionListError;
}

/** What `decodeUsage` reads: a source from `listUsageSources`, or another path of the agent's layout. */
export interface UsageTarget {
  readonly path: string;
}

/** The platform has no SQLite, which the agent's database needs. */
export interface SqliteUnavailable {
  readonly _tag: "SqliteUnavailable";
  readonly path: string;
}

/**
 * The expected failures of decoding one source. `SourceChanged` means the file is no longer the one the cursor was
 * taken from (it was rewritten); the stream's cursor is then `undefined`, so the next decode reads the file from its
 * start. Records yielded before a failure stay valid.
 */
export type UsageDecodeError =
  | SessionNotFound
  | ReadFailed
  | UnknownFormatGeneration
  | SourceChanged
  | CapabilityUnsupported
  | SqliteUnavailable;

export interface UsageDecodeFailure {
  readonly agent: CodingAgentId;
  readonly path: string;
  readonly error: UsageDecodeError;
}

/**
 * The usage records of one source, in source order, and its failures. Iterate it once; leaving the loop stops the
 * reads. An abort rejects with `signal.reason`; only defects throw.
 */
export interface UsageStream extends AsyncIterable<UsageRecord | UsageDecodeFailure> {
  /**
   * Where a later decode continues: after the last item the loop received, or where the decode ended once the loop has
   * run to its end. Before the first item it is the `from` cursor the decode started at; after `SourceChanged` it is
   * `undefined`.
   */
  readonly cursor: UsageCursor | undefined;
}

export interface UsageSourceOptions {
  /** Leaves out sources last modified before this time, in epoch milliseconds. */
  readonly since?: number;
  readonly signal?: AbortSignal;
}

export interface DecodeUsageOptions {
  /** A cursor from an earlier decode of the same source. */
  readonly from?: UsageCursor;
  /** Leaves out records before this time, in epoch milliseconds. They still advance the cursor. */
  readonly since?: number;
  /** Ends the decode at the first record at or after this time; the cursor stays before that record. */
  readonly until?: number;
  /**
   * The source is complete: nothing more will be written to it. Requests that could still get records where the
   * source ends (Claude Code's open requests, a Codex fork's undecided first usage record, opencode's unfinished
   * messages) are then reported as they are. Without it they stay in the cursor until a later decode decides them.
   */
  readonly final?: boolean;
  /**
   * Decodes with `final` when the source was last modified before this time, in epoch milliseconds, as the decode
   * finds it when it starts; it then reads no further than the size it found, so bytes appended meanwhile wait for the
   * next decode.
   */
  readonly quietBefore?: number;
  readonly signal?: AbortSignal;
}

/**
 * Where one CodingAgent keeps its usage and how to decode it; `builtinUsageDecoders` has one per built-in agent. The
 * use cases select decoders from that table. Provider implementations use this interface.
 */
export interface UsageDecoder {
  readonly specificationVersion: "usage-v1";
  readonly agent: CodingAgentId;
  /** This agent's home rule, used instead of catalog's; required for an agent catalog has no rule for. */
  readonly home?: HomeRule;
  /** The sources under the agent's home. A missing root or an unreadable directory is a failure item. */
  sources(
    platform: UsagePlatform,
    home: AgentHome,
    options?: UsageSourceOptions
  ): AsyncIterable<UsageSource | UsageSourceFailure>;
  /** Decodes one source, from its start or from `options.from`. `until` is the use case's. */
  decode(platform: UsagePlatform, target: UsageTarget, options?: DecodeUsageOptions): UsageStream;
  /**
   * The key under which `scanUsage` counts a record once in its window, unique within the scope where the agent's
   * files repeat records; `undefined` for a record without one.
   */
  usageKey(record: UsageRecord): string | undefined;
}

/** Usage decoders by agent id. */
export type UsageDecoders = ServiceTable<UsageDecoder>;
