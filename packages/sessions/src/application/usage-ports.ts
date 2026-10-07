import type { AgentHome, CodingAgentId, HomeRule } from "@rivus/agent-kit-catalog";
import type { PlatformSqlite } from "@rivus/agent-kit-platform";

import type { CapabilityUnsupported, ReadFailed, SessionListError, SessionNotFound } from "../domain/session/index.js";
import type { SourceChanged, UnknownFormatGeneration } from "../domain/transcript/index.js";
import type { UsageRecord } from "../domain/usage/index.js";
import type { SessionPlatform } from "./ports.js";

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

/**
 * Where a decode of one source stopped, as plain JSON data. Passed back as `from`, it continues there without reading
 * the source again: the next decode yields only what was written since. It belongs to the source it came from.
 */
export interface UsageCursor {
  readonly agent: CodingAgentId;
  /** Bytes read from the start of the file; 0 for a database or a directory. */
  readonly offset: number;
  /** Lines read; 0 for a database or a directory. */
  readonly line: number;
  /**
   * What the agent's rules keep between records, such as Codex's cumulative totals, the Claude Code requests that may
   * still get records, or a database's position.
   */
  readonly state?: unknown;
  /** Records decoded but not yet yielded when the loop was left. */
  readonly queue?: readonly UsageRecord[];
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
 * use cases do not take others yet: until a caller outside the kit needs to, this interface stays internal.
 */
export interface UsageDecoder {
  readonly specificationVersion: "usage-v1";
  readonly agent: CodingAgentId;
  /** The home rule of an agent that catalog does not know. Built-in agents use catalog's rule. */
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
export type UsageDecoders = Readonly<Partial<Record<CodingAgentId, UsageDecoder>>>;
