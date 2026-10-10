import type { SkippedRecord, SourcedRecord } from "../../../domain/transcript/index.js";
import { type ReadOptions, readLines } from "./read-file.js";
import type { SessionPlatform } from "../../ports.js";

export interface JsonlRecords {
  records: SourcedRecord[];
  /** Lines that are not JSON, with the reason `invalid-json`. */
  skipped: SkippedRecord[];
}

/**
 * Every non-blank line of a JSONL file, parsed, with its source pointer — one at a time, so a caller that keeps no
 * records holds no transcript. A line that is not JSON is skipped and handed to `onSkip`; leaving the loop stops the
 * read. `readJsonlRecords` collects the same stream into arrays.
 */
export async function* readJsonlStream(
  platform: SessionPlatform,
  file: string,
  options: ReadOptions = {},
  onSkip?: (skipped: SkippedRecord) => void
): AsyncGenerator<SourcedRecord, void, undefined> {
  for await (const line of readLines(platform, file, options)) {
    if (!line.text.trim()) {
      continue;
    }
    const source = { file, offset: line.offset, length: line.byteLength, line: line.lineNumber };
    try {
      yield { ...source, value: JSON.parse(line.text) as unknown };
    } catch {
      onSkip?.({ reason: "invalid-json", source });
    }
  }
}

/** Every non-blank line of a JSONL file, parsed, with its source pointer. A line that is not JSON is skipped. */
export async function readJsonlRecords(
  platform: SessionPlatform,
  file: string,
  options: ReadOptions = {}
): Promise<JsonlRecords> {
  const records: SourcedRecord[] = [];
  const skipped: SkippedRecord[] = [];
  for await (const record of readJsonlStream(platform, file, options, (skip) => skipped.push(skip))) {
    records.push(record);
  }
  return { records, skipped };
}
