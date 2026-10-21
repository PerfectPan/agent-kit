import { fileURLToPath } from "node:url";
import type { ConformanceSession } from "@rivus/agent-kit-testing";
import { readTree } from "../../../testing/test/support.js";
/** The Codex fixture sessions under `root` (the fixtures' `conformance` directory) and what each shows. */
export function codexSessions(root: string): ConformanceSession[] {
  const at = (name: string) => `${root}/rollout-${name}.jsonl`;
  return [
    { path: at("plain"), records: 14, capabilities: ["requests", "usage", "durations", "reasoning", "systemPrompt"] },
    { path: at("token-count"), records: 14, capabilities: ["requests", "usage"] },
    { path: at("compaction"), records: 11, capabilities: ["compaction", "subagents"] },
    { path: at("subagent"), records: 9, capabilities: ["subagents"] },
    { path: at("unknown"), records: 7, capabilities: [] },
    { path: at("fork"), records: 20, capabilities: ["requests", "usage", "durations", "reasoning", "systemPrompt"] },
    { path: at("fork-one-call"), records: 19, capabilities: ["requests", "usage", "durations"] },
    { path: at("legacy"), records: 9, capabilities: ["reasoning"] },
    { path: at("interrupted"), records: 12, capabilities: ["requests", "usage", "durations"] },
    { path: at("duplicate-usage"), records: 5, capabilities: ["requests", "usage"] },
    { path: at("token-delta"), records: 6, capabilities: ["requests", "usage"] }
  ];
}

export async function readUsageHome(home: string): Promise<Record<string, Uint8Array>> {
  return readTree(fileURLToPath(new URL("fixtures/usage", import.meta.url)), `${home}/.codex`);
}
