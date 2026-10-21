import type { ServiceTable } from "@rivus/agent-kit-catalog/public";
import type { InstallAdapter } from "../domain/bundle/spi/install-adapter.js";
import type { HookDialect } from "../domain/lifecycle/spi/hook-dialect.js";

export interface InstallProviders {
  readonly install: ServiceTable<InstallAdapter>;
  readonly hooks: ServiceTable<HookDialect>;
}
