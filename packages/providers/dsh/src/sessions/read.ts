import type { SkippedRecord, SourcedRecord } from "@rivus/agent-kit-sessions/spi";

const encoder = new TextEncoder();

export interface DshTextRecords {
  records: SourcedRecord[];
  skipped: SkippedRecord[];
}

/**
 * The JSONL records of a decoded session log, with source pointers into the decoded text: byte offsets count the
 * decoded stream, and `codec` tells the reader to decode the file again.
 */
export function splitDshRecords(text: string, file: string, codec: "zstd" | undefined): DshTextRecords {
  const records: SourcedRecord[] = [];
  const skipped: SkippedRecord[] = [];
  const lines = text.split("\n");
  let offset = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const length = encoder.encode(line).byteLength;
    if (line.trim().length > 0) {
      const source = {
        file,
        offset,
        length,
        line: index + 1,
        ...(codec === undefined ? {} : { codec })
      };
      try {
        records.push({ ...source, value: JSON.parse(line) as unknown });
      } catch {
        skipped.push({ reason: "invalid-json", source });
      }
    }
    offset += length + 1;
  }
  return { records, skipped };
}
