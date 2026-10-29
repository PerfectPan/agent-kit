import type { ConformanceSession } from "@rivus/agent-kit-testing/public";
import { fileURLToPath } from "node:url";
import { readTree } from "../../../testing/test/support.js";

/** The Grok fixture sessions under `root` (the fixtures' `conformance` directory) and what each shows. */
export function grokSessions(root: string): ConformanceSession[] {
  const at = (path: string) => `${root}/${path}`;
  return [
    {
      path: at("plain/updates.jsonl"),
      records: 9,
      capabilities: ["requests", "usage", "durations", "reasoning", "hooks", "systemPrompt", "toolSchemas"]
    },
    { path: at("compaction/updates.jsonl"), records: 4, capabilities: ["compaction", "compactionTokens"] },
    { path: at("subagent/updates.jsonl"), records: 6, capabilities: ["subagents"] },
    { path: at("tool-title/updates.jsonl"), records: 5, capabilities: ["requests"] },
    { path: at("unknown-type/updates.jsonl"), records: 1, capabilities: [] },
    {
      path: at("tool-progress/updates.jsonl"),
      records: 10,
      capabilities: ["requests", "usage", "durations"]
    },
    { path: at("duplicate-turn/updates.jsonl"), records: 6, capabilities: ["requests", "usage", "durations"] },
    {
      path: at("subagent-meta-id/updates.jsonl"),
      records: 4,
      capabilities: ["requests", "usage", "durations", "subagents"]
    },
    { path: at("request-id-collision/updates.jsonl"), records: 2, capabilities: ["requests", "usage"] }
  ];
}

export async function readUsageHome(home: string): Promise<Record<string, Uint8Array>> {
  return readTree(fileURLToPath(new URL("fixtures/usage", import.meta.url)), `${home}/.grok`);
}
