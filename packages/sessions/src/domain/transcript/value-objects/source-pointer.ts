import { definedFields } from "@rivus/agent-kit-catalog/public";

/** The SQLite row an event's original is, when the session lives in a database. */
export interface SqliteSourcePointer {
  /** Table and column names; the reader validates both as SQL identifiers. */
  readonly table: string;
  readonly column: string;
  /** The rowid of the row in `table`. */
  readonly rowid: number;
}

/**
 * Where an event's original record is: reading `length` bytes at `offset` of `file` returns it. A compressed file
 * counts decompressed bytes, and a session kept in SQLite names its row instead of a byte range.
 */
export interface SourcePointer {
  file: string;
  offset: number;
  length: number;
  /** 1-based. */
  line: number;
  /** The file is compressed, and `offset`/`length` index its decompressed stream. */
  codec?: "zstd";
  /** The original is one SQLite row of `file`, not the bytes at `offset`. */
  sqlite?: SqliteSourcePointer;
}

/** A parsed record of an agent's file with the location of its bytes; the input of every translation. */
export interface SourcedRecord extends SourcePointer {
  value: unknown;
}

/**
 * A record that became no event: a line that is not JSON, bookkeeping the model never saw, or a file next to the
 * session that holds no records. For a whole file, `offset` is 0, `line` is 1 and `length` is its size.
 */
export interface SkippedRecord {
  reason: string;
  source: SourcePointer;
}

export function sourceOf(record: SourcePointer): SourcePointer {
  return definedFields({
    file: record.file,
    offset: record.offset,
    length: record.length,
    line: record.line,
    codec: record.codec,
    sqlite: record.sqlite
  });
}
