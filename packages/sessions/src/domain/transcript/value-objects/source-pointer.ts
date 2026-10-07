/** Where an event's original record is: reading `length` bytes at `offset` of `file` returns it. */
export interface SourcePointer {
  file: string;
  offset: number;
  length: number;
  /** 1-based. */
  line: number;
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
  return { file: record.file, offset: record.offset, length: record.length, line: record.line };
}
