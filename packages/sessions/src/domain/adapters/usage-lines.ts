import type { Result } from "@rivus/agent-kit-catalog";

import type { SourcedRecord, UnknownFormatGeneration } from "../transcript/index.js";
import type { UsageRecord } from "../usage/index.js";

/**
 * One agent's usage rules over the records of one file, fed in file order. Between records it keeps only what the
 * rules need, as plain JSON data (`save`), so a cursor can carry it and a later decode continue from there.
 */
export interface UsageLineDecoder {
  /** The records that `record` completes. An unknown format generation ends the file. */
  push(record: SourcedRecord): Result<UsageRecord[], UnknownFormatGeneration>;
  /**
   * Where the file ends for now. With `final`, the file is complete and the records still open are reported; without
   * it they stay in the state, for the records a later decode may append.
   */
  end(final: boolean): UsageRecord[];
  save(): unknown;
}

/** What a usage decoder knows about the file besides its records. */
export interface UsageFile {
  readonly path: string;
  /** The session id when the records name none. */
  readonly sessionId: string;
  /** The time of a record that has none and follows no record that has one. */
  readonly mtimeMs: number;
  /** The lane of a subagent file whose records name none. */
  readonly agentLaneId?: string;
}

/** Remembers `key` among the last `size` keys, dropping the oldest. */
export function rememberKey(keys: string[], key: string, size: number): void {
  keys.push(key);
  if (keys.length > size) {
    keys.splice(0, keys.length - size);
  }
}
