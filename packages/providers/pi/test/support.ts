import { fileURLToPath } from "node:url";

import type { ConformanceSession } from "@rivus/agent-kit-testing/public";
import { readTree } from "../../../testing/test/support.js";

/** The Pi fixture sessions under `root` (the fixtures' `conformance` directory) and what each shows. */
export function piSessions(root: string): ConformanceSession[] {
  const at = (path: string) => `${root}/${path}`;
  return [
    {
      path: at("plain/session.jsonl"),
      records: 8,
      capabilities: ["requests", "usage", "reasoning"]
    },
    {
      path: at("compaction/session.jsonl"),
      records: 8,
      capabilities: ["requests", "usage", "compaction", "compactionTokens"]
    },
    { path: at("unknown-type/session.jsonl"), records: 3, capabilities: [] }
  ];
}

export async function readUsageHome(home: string): Promise<Record<string, Uint8Array>> {
  return readTree(fileURLToPath(new URL("fixtures/usage", import.meta.url)), `${home}/.pi/agent`);
}
