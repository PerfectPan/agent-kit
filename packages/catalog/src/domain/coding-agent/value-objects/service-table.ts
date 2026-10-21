import type { CodingAgentId } from "./coding-agent-id.js";

/** Providers of one service, keyed by agent id. An absent entry means the capability is unsupported. */
export type ServiceTable<T> = Readonly<Partial<Record<CodingAgentId, T>>>;
