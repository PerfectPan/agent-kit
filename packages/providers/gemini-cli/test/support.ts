import { fileURLToPath } from "node:url";
import type { ConformanceSession } from "@rivus/agent-kit-testing/public";
import { readTree } from "../../../testing/test/support.js";

export async function readUsageHome(home: string): Promise<Record<string, Uint8Array>> {
  return readTree(fileURLToPath(new URL("fixtures/usage", import.meta.url)), `${home}/.gemini/tmp`);
}

/** The Gemini CLI fixture sessions under `root` (the fixtures' `conformance` directory) and what each shows. */
export function geminiSessions(root: string): ConformanceSession[] {
  const at = (path: string) => `${root}/${path}`;
  return [
    {
      path: at("conformance/plain/chats/session-1.jsonl"),
      records: 9,
      capabilities: ["requests", "usage", "reasoning"]
    },
    {
      path: at("conformance/compaction/chats/session-1.jsonl"),
      records: 6,
      capabilities: ["compaction", "compactionTokens"]
    },
    { path: at("conformance/message-update/chats/session-1.jsonl"), records: 5, capabilities: ["requests", "usage"] },
    { path: at("conformance/unknown-type/chats/session-1.jsonl"), records: 2, capabilities: [] }
  ];
}
