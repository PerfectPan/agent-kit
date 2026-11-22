import type { ConformanceSession } from "@rivus/agent-kit-testing/public";

/** The DeepSeek Harness fixture sessions under `root` (the fixtures' `conformance` directory). */
export function dshSessions(root: string): ConformanceSession[] {
  const at = (path: string) => `${root}/${path}`;
  return [
    {
      path: at("plain/session.v4.jsonl"),
      records: 9,
      capabilities: ["requests", "usage", "reasoning", "systemPrompt", "toolSchemas"]
    },
    {
      path: at("timed/session.v4.jsonl"),
      records: 10,
      capabilities: ["requests", "usage", "durations", "reasoning"]
    },
    {
      path: at("parent/session.v4.jsonl"),
      records: 9,
      capabilities: ["requests", "usage", "subagents"]
    },
    {
      path: at("hooks/session.v4.jsonl"),
      records: 5,
      capabilities: ["requests", "usage", "hooks"]
    },
    {
      path: at("compaction/session.v4.jsonl"),
      records: 10,
      capabilities: ["requests", "usage", "compaction", "compactionTokens", "systemPrompt"]
    },
    { path: at("unknown-type/session.v4.jsonl"), records: 3, capabilities: [] }
  ];
}
