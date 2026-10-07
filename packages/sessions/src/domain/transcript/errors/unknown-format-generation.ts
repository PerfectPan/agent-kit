import type { CodingAgentId } from "@rivus/agent-kit-catalog";

import type { SourcePointer } from "../value-objects/source-pointer.js";

/** A record whose envelope the adapter does not recognize, so the whole file is from a format it cannot read. */
export interface UnknownFormatGeneration {
  readonly _tag: "UnknownFormatGeneration";
  readonly agent: CodingAgentId;
  readonly file: string;
  readonly line: number;
}

export function unknownFormatGeneration(agent: CodingAgentId, record: SourcePointer): UnknownFormatGeneration {
  return { _tag: "UnknownFormatGeneration", agent, file: record.file, line: record.line };
}
