import type { CodingAgent, ServiceTable } from "@rivus/agent-kit-catalog/public";
import type { SessionAdapter, UsageDecoder } from "./spi.js";

export interface SessionProviders {
  readonly sessions: ServiceTable<SessionAdapter>;
  readonly identity: ServiceTable<CodingAgent>;
}

export interface UsageProviders {
  readonly usage: ServiceTable<UsageDecoder>;
  readonly identity: ServiceTable<CodingAgent>;
}
