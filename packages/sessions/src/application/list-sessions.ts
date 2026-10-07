import {
  type AgentHome,
  type CodingAgentId,
  homeFromRule,
  isBuiltinCodingAgentId,
  parseCodingAgentId,
  resolveHome
} from "@rivus/agent-kit-catalog";
import type { Platform } from "@rivus/agent-kit-platform";

import type { SessionHead, SessionListFailure } from "../domain/session/index.js";
import { capabilityUnsupported } from "./errors.js";
import type { SessionAdapter, SessionAdapters, SessionPlatform } from "./ports.js";
import { builtinSessionAdapters } from "./session-adapters/index.js";

export interface ListSessionsOptions {
  /** Agents to list, by id or alias; defaults to every agent in `adapters`. */
  readonly agents?: readonly CodingAgentId[];
  /** Replaces `builtinSessionAdapters` for this call; spread it to extend it. */
  readonly adapters?: SessionAdapters;
  readonly signal?: AbortSignal;
  /** Called with the running total of session files each time another root has been listed. */
  readonly onTotal?: (files: number) => void;
}

/**
 * Lists the sessions of each agent from its homes' roots, one head per session file, reading at most 64 KB from
 * each end of a file. A missing root or an unreadable file is a failure item and listing goes on. Throws
 * `capability-unsupported` when a requested agent has no adapter; leaving the loop stops the reads.
 */
export async function* listSessions(
  platform: SessionPlatform & Pick<Platform, "env" | "home">,
  options: ListSessionsOptions = {}
): AsyncGenerator<SessionHead | SessionListFailure, void, undefined> {
  const table: SessionAdapters = options.adapters ?? builtinSessionAdapters;
  const adapters = selectAdapters(table, options.agents ?? Object.keys(table));
  let total = 0;
  const onTotal = (files: number): void => {
    total += files;
    options.onTotal?.(total);
  };
  for (const adapter of adapters) {
    for (const root of adapter.roots(homeOf(adapter, platform))) {
      options.signal?.throwIfAborted();
      yield* adapter.discover(platform, root, { ...(options.signal ? { signal: options.signal } : {}), onTotal });
    }
  }
}

function selectAdapters(table: SessionAdapters, agents: readonly CodingAgentId[]): SessionAdapter[] {
  const selected = new Map<CodingAgentId, SessionAdapter>();
  for (const requested of agents) {
    const parsed = parseCodingAgentId(requested);
    const agent = parsed.ok ? parsed.value : requested;
    const adapter = table[agent];
    if (!adapter) {
      throw capabilityUnsupported(agent);
    }
    selected.set(agent, adapter);
  }
  return [...selected.values()];
}

function homeOf(adapter: SessionAdapter, platform: Pick<Platform, "env" | "home">): AgentHome {
  if (adapter.home) {
    return homeFromRule(adapter.agent, adapter.home, platform);
  }
  if (isBuiltinCodingAgentId(adapter.agent)) {
    return resolveHome(adapter.agent, platform);
  }
  throw capabilityUnsupported(adapter.agent, "has a session adapter without a home rule, and catalog does not know it");
}
