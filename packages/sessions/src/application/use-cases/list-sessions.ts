import type { AgentHome, CodingAgentId, HomeContext, CodingAgent, ServiceTable } from "@rivus/agent-kit-catalog/public";
import type { Platform } from "@rivus/agent-kit-platform/public";

import type { SessionHead, SessionListFailure } from "../../domain/session/value-objects/session-head.js";
import { adapterHome, selectAdapters } from "../services/adapter-table.js";
import type { SessionAdapter, SessionPlatform } from "../spi.js";
import type { SessionProviders } from "../providers.js";

export interface ListSessionsOptions {
  /** Agents to list, by id or alias; defaults to every agent in `providers.sessions`. */
  readonly agents?: readonly CodingAgentId[];
  readonly providers: SessionProviders;
  readonly signal?: AbortSignal;
  /** Called with the running total of session files each time another root has been listed. */
  readonly onTotal?: (files: number) => void;
}

/**
 * The home whose `roots` an adapter lists: the adapter's own home rule, else the catalog's rule for a built-in agent.
 * Throws `capability-unsupported` when there is neither. For a caller that walks an adapter's roots itself, for
 * example to report progress per root, instead of through `listSessions`.
 */
export function sessionAdapterHome(
  adapter: Pick<SessionAdapter, "agent" | "home">,
  context: HomeContext,
  identities: ServiceTable<CodingAgent>
): AgentHome {
  return adapterHome(adapter, context, "session adapter", identities);
}

/**
 * Lists the sessions of each agent from its homes' roots, one head per session file, reading at most 64 KB from
 * each end of a file. A missing root or an unreadable file is a failure item and listing goes on. Throws
 * `capability-unsupported` when a requested agent has no adapter; leaving the loop stops the reads.
 */
export async function* listSessions(
  platform: SessionPlatform & Pick<Platform, "env" | "home">,
  options: ListSessionsOptions
): AsyncGenerator<SessionHead | SessionListFailure, void, undefined> {
  const table = options.providers.sessions;
  const adapters = selectAdapters(
    table,
    options.agents ?? Object.keys(table),
    "session adapter",
    options.providers.identity
  );
  let total = 0;
  const onTotal = (files: number): void => {
    total += files;
    options.onTotal?.(total);
  };
  for (const adapter of adapters) {
    for (const root of adapter.roots(sessionAdapterHome(adapter, platform, options.providers.identity))) {
      options.signal?.throwIfAborted();
      yield* adapter.discover(platform, root, { ...(options.signal ? { signal: options.signal } : {}), onTotal });
    }
  }
}
