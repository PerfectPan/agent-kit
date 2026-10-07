import type { CodingAgentId } from "@rivus/agent-kit-catalog";

import type { SkippedRecord } from "./source-pointer.js";
import type { TranscriptEvent } from "./transcript-event.js";

/** What an agent's logs can record. A count whose capability a transcript does not list is absent, never 0. */
export type Capability =
  | "requests"
  | "usage"
  | "durations"
  | "reasoning"
  | "compaction"
  | "compactionTokens"
  | "subagents"
  | "systemPrompt"
  | "toolSchemas"
  | "hooks";

export const CAPABILITIES: readonly Capability[] = [
  "requests",
  "usage",
  "durations",
  "reasoning",
  "compaction",
  "compactionTokens",
  "subagents",
  "systemPrompt",
  "toolSchemas",
  "hooks"
];

/** One agent's execution line in a Session. The main agent has no `parentId`; a subagent names its parent lane. */
export interface Lane {
  id: string;
  parentId?: string;
  /** The `tool_call` event that started this subagent, when the log records it. */
  spawnEventId?: string;
  title?: string;
  /** This lane's own system prompt, when the agent records one per lane. */
  systemPrompt?: string;
}

export interface TranscriptSession {
  id: string;
  title?: string;
  cwd?: string;
  startedAt?: number;
  endedAt?: number;
  /** The main lane's latest recorded system prompt. */
  systemPrompt?: string;
  /** The main lane's latest recorded tool definitions. */
  tools?: unknown;
}

/** The ordered events of a Session, merged from all its files, with the records that became no event. */
export interface Transcript {
  agent: CodingAgentId;
  /** The agent version the log records. */
  agentVersion?: string;
  session: TranscriptSession;
  /** What these files record: a subset of the adapter's capabilities. */
  capabilities: Capability[];
  agents: Lane[];
  events: TranscriptEvent[];
  skipped: SkippedRecord[];
}
