import type { CodingAgent, ServiceTable } from "@rivus/agent-kit-catalog";
import type { InstallAdapter } from "../domain/bundle/spi/install-adapter.js";
import type { HookDialect } from "../domain/lifecycle/spi/hook-dialect.js";

export interface InstallProviders {
  readonly install: ServiceTable<InstallAdapter>;
  readonly hooks: ServiceTable<HookDialect>;
  readonly identity: ServiceTable<CodingAgent>;
}
