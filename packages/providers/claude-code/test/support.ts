import { fileURLToPath } from "node:url";
import type { ConformanceSession } from "@rivus/agent-kit-testing/public";
import { readTree } from "../../../testing/test/support.js";

/** The Claude Code fixture sessions under `root` (the fixtures' `conformance` directory) and what each shows. */
export function claudeCodeSessions(root: string): ConformanceSession[] {
  const at = (path: string) => `${root}/${path}`;
  return [
    {
      path: at("plain/session.jsonl"),
      records: 7,
      capabilities: ["requests", "usage", "durations", "reasoning", "hooks"]
    },
    { path: at("compaction/session.jsonl"), records: 7, capabilities: ["compaction", "compactionTokens"] },
    {
      path: at("subagent/session.jsonl"),
      files: [at("subagent/session.jsonl"), at("subagent/session/subagents/agent-helper.jsonl")],
      records: 5,
      capabilities: ["subagents"]
    },
    { path: at("unknown-type/session.jsonl"), records: 6, capabilities: [] },
    {
      path: at("regroup/session.jsonl"),
      files: [at("regroup/session.jsonl"), at("regroup/session/subagents/workflows/wf-demo/agent-nested.jsonl")],
      records: 16,
      capabilities: ["requests", "usage", "subagents"]
    },
    {
      path: at("prompt-snapshot/session.jsonl"),
      files: [at("prompt-snapshot/session.jsonl"), at("prompt-snapshot/session/subagents/agent-worker.jsonl")],
      records: 13,
      capabilities: ["requests", "usage", "subagents", "systemPrompt", "toolSchemas"]
    },
    {
      path: at("empty-ids/session.jsonl"),
      files: [
        at("empty-ids/session.jsonl"),
        at("empty-ids/session/subagents/agent-.jsonl"),
        at("empty-ids/session/subagents/agent-mixed.jsonl")
      ],
      records: 9,
      capabilities: ["requests", "usage", "subagents"]
    },
    {
      path: at("summarize/session.jsonl"),
      files: [
        at("summarize/session.jsonl"),
        at("summarize/session/subagents/agent-helper.jsonl"),
        at("summarize/session/subagents/agent-fallback.jsonl")
      ],
      records: 11,
      capabilities: ["requests", "usage", "durations", "subagents"]
    }
  ];
}

export async function readUsageHome(home: string): Promise<Record<string, Uint8Array>> {
  return readTree(fileURLToPath(new URL("fixtures/usage", import.meta.url)), `${home}/.claude`);
}
