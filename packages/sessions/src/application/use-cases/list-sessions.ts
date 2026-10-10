import type { AgentHome, CodingAgentId, HomeContext } from "@rivus/agent-kit-catalog";
import type { Platform } from "@rivus/agent-kit-platform";

import type { SessionHead, SessionListFailure } from "../../domain/session/index.js";
import { adapterHome, selectAdapters } from "../services/adapter-table.js";
import type { SessionAdapter, SessionAdapters, SessionPlatform } from "../ports.js";
import { builtinSessionAdapters } from "../services/session-adapters/index.js";

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
 * The home whose `roots` an adapter lists: the adapter's own home rule, else the catalog's rule for a built-in agent.
 * Throws `capability-unsupported` when there is neither. For a caller that walks an adapter's roots itself, for
 * example to report progress per root, instead of through `listSessions`.
 */
export function sessionAdapterHome(adapter: Pick<SessionAdapter, "agent" | "home">, context: HomeContext): AgentHome {
  return adapterHome(adapter, context, "session adapter");
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
  const adapters = selectAdapters(table, options.agents ?? Object.keys(table), "session adapter");
  let total = 0;
  const onTotal = (files: number): void => {
    total += files;
    options.onTotal?.(total);
  };
  for (const adapter of adapters) {
    for (const root of adapter.roots(sessionAdapterHome(adapter, platform))) {
      options.signal?.throwIfAborted();
      yield* adapter.discover(platform, root, { ...(options.signal ? { signal: options.signal } : {}), onTotal });
    }
  }
}
