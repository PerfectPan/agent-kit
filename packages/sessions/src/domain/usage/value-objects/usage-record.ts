import type { CodingAgentId } from "@rivus/agent-kit-catalog";

import type { SourcePointer } from "../../transcript/index.js";
import type { Usage } from "./usage.js";

/**
 * What one record's `usage` covers. `request` is one model request; `turn` and `session` are aggregates the agent
 * reports, with `modelCalls`, and are never split into invented per-request records.
 */
export type UsageGranularity = "request" | "turn" | "session";

/** `agent`: the agent logged the amount; `pricing-table`: it was computed from a price table. */
export type CostSource = "agent" | "pricing-table";

/** One model's share of an aggregate record. */
export interface ModelUsage {
  usage: Usage;
  modelCalls?: number;
  costUsd?: number;
  costSource?: CostSource;
}

/**
 * Usage of one agent, session and source location, in the convention of `Usage`. A count, cost or field the log does
 * not record is absent, never 0.
 */
export interface UsageRecord {
  agent: CodingAgentId;
  sessionId: string;
  /** The subagent lane that made the calls; absent for the main agent. */
  agentLaneId?: string;
  granularity: UsageGranularity;
  /** How many model calls a `turn` or `session` record covers. */
  modelCalls?: number;
  /** The agent's id of the model request. With `responseId`, it identifies a request that several files repeat. */
  requestId?: string;
  /** gen_ai.response.id */
  responseId?: string;
  /** Epoch milliseconds of the request, or of the end of the aggregate. */
  timestamp: number;
  /** gen_ai.request.model */
  model?: string;
  /** gen_ai.provider.name, when the agent records it. */
  provider?: string;
  usage: Usage;
  /** The same usage split by model. A total takes `usage` or this split, never both added together. */
  usageByModel?: Record<string, ModelUsage>;
  costUsd?: number;
  costSource?: CostSource;
  /** A price factor the request was billed with, such as 2 for a priority service tier. Absent means 1. */
  pricingMultiplier?: number;
  /** The record the usage was read from; for a request written as several records, the first one. */
  source: SourcePointer;
}
