import { err, ok, type Result } from "@rivus/agent-kit-catalog/public";
import type { SqliteDatabase, SqliteValue } from "@rivus/agent-kit-platform/public";

import type { ReadFailed, SessionNotFound } from "../../domain/session/errors/session-read-error.js";
import type { SourceChanged } from "../../domain/transcript/errors/source-changed.js";
import type { SourcePointer } from "../../domain/transcript/value-objects/source-pointer.js";
import { catchIoFailure } from "../services/files/io-failure.js";
import { readBytes, type ReadProgress } from "../services/files/read-file.js";
import type { SessionPlatform } from "../spi.js";

export type ReadOriginalError = SourceChanged | SessionNotFound | ReadFailed;

/** A table or column name a pointer may name; the pattern keeps a pointer from carrying its own SQL. */
const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function readFailed(source: SourcePointer, message: string, cause?: unknown): ReadFailed {
  return {
    _tag: "ReadFailed",
    path: source.file,
    message,
    ...(cause === undefined ? {} : { cause })
  };
}

/** The bytes of one SQLite row's column, or a failure naming why they are not readable. */
function sqliteBytes(platform: SessionPlatform, source: SourcePointer): Result<Uint8Array, ReadFailed> {
  const row = source.sqlite;
  if (row === undefined) {
    return err(readFailed(source, "the source pointer names no SQLite row"));
  }
  if (!SQL_IDENTIFIER.test(row.table) || !SQL_IDENTIFIER.test(row.column)) {
    return err(readFailed(source, `invalid SQLite identifier ${row.table}.${row.column}`));
  }
  const sqlite = platform.sqlite;
  if (sqlite === undefined) {
    return err(readFailed(source, "SQLite is not available on this platform"));
  }
  let database: SqliteDatabase | undefined;
  try {
    database = sqlite.open(source.file, { readonly: true });
    const value: SqliteValue | undefined = database
      .prepare(`SELECT ${row.column} AS value FROM ${row.table} WHERE rowid = ?`)
      .get(row.rowid)?.value;
    if (value === undefined || value === null) {
      return err(readFailed(source, `no row ${row.rowid} in ${row.table}`));
    }
    if (typeof value === "string") {
      return ok(encoder.encode(value));
    }
    if (value instanceof Uint8Array) {
      return ok(value);
    }
    return ok(encoder.encode(String(value)));
  } catch (error) {
    return err(readFailed(source, error instanceof Error ? error.message : String(error), error));
  } finally {
    database?.close();
  }
}

/** The bytes a source pointer names, decoded when the file is compressed and read from SQLite when it is a row. */
async function sourceBytes(
  platform: SessionPlatform,
  source: SourcePointer,
  options: { readonly signal?: AbortSignal }
): Promise<Result<Uint8Array, SourceChanged | SessionNotFound | ReadFailed>> {
  if (source.sqlite !== undefined) {
    return sqliteBytes(platform, source);
  }
  if (source.codec !== undefined) {
    const whole = await catchIoFailure(platform, source.file, options.signal, (guarded) =>
      readBytes(guarded, source.file, { start: 0 }, options)
    );
    if (!whole.ok) {
      return whole;
    }
    const decompress = platform.decompress;
    if (decompress === undefined) {
      return err(readFailed(source, `${source.codec} decompression is not available on this platform`));
    }
    let decoded: Uint8Array;
    try {
      decoded = decompress(source.codec, whole.value);
    } catch (error) {
      return err(readFailed(source, error instanceof Error ? error.message : String(error), error));
    }
    return ok(decoded.subarray(source.offset, source.offset + source.length));
  }
  return catchIoFailure(platform, source.file, options.signal, (guarded) =>
    readBytes(guarded, source.file, { start: source.offset, end: source.offset + source.length }, options)
  );
}

/**
 * Reads an event's record back from its source pointer and parses it. `SourceChanged` means those bytes are no
 * longer one JSON value, because the file changed after the transcript was loaded. An abort rejects with
 * `signal.reason`; only defects throw.
 */
export async function readOriginal(
  platform: SessionPlatform,
  source: SourcePointer,
  options: { readonly signal?: AbortSignal; readonly progress?: ReadProgress } = {}
): Promise<Result<unknown, ReadOriginalError>> {
  const bytes = await sourceBytes(platform, source, options);
  if (!bytes.ok) {
    return bytes;
  }
  try {
    return ok(JSON.parse(decoder.decode(bytes.value)) as unknown);
  } catch {
    return err({ _tag: "SourceChanged", source });
  }
}
