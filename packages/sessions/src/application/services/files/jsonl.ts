import type { SkippedRecord, SourcedRecord } from "../../../domain/transcript/index.js";
import { type ReadOptions, readLines } from "./read-file.js";
import type { SessionPlatform } from "../../ports.js";

export interface JsonlRecords {
  records: SourcedRecord[];
  /** Lines that are not JSON, with the reason `invalid-json`. */
  skipped: SkippedRecord[];
}

/** Every non-blank line of a JSONL file, parsed, with its source pointer. A line that is not JSON is skipped. */
export async function readJsonlRecords(
  platform: SessionPlatform,
  file: string,
  options: ReadOptions = {}
): Promise<JsonlRecords> {
  const records: SourcedRecord[] = [];
  const skipped: SkippedRecord[] = [];
  for await (const line of readLines(platform, file, options)) {
    if (!line.text.trim()) {
      continue;
    }
    const source = { file, offset: line.offset, length: line.byteLength, line: line.lineNumber };
    try {
      records.push({ ...source, value: JSON.parse(line.text) as unknown });
    } catch {
      skipped.push({ reason: "invalid-json", source });
    }
  }
  return { records, skipped };
}
