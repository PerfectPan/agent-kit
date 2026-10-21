import type { CodingAgent, CodingAgentId } from "@rivus/agent-kit-catalog/public";
import type { ProbeRecipe } from "@rivus/agent-kit-discovery/public";
import type { InstallAdapter } from "@rivus/agent-kit-harness/public/install";
import type { HookDialect } from "@rivus/agent-kit-harness/public/events";
import type { SessionAdapter, UsageDecoder } from "@rivus/agent-kit-sessions/public";
import type { AcpProfile } from "@rivus/agent-kit-acp/public/profiles";

/** Services supplied for one agent; omitted services retain their built-in implementations. */
export interface Provider {
  readonly id: CodingAgentId;
  readonly identity?: CodingAgent;
  readonly discovery?: ProbeRecipe;
  readonly hooks?: HookDialect;
  readonly install?: InstallAdapter;
  readonly sessions?: SessionAdapter;
  readonly usage?: UsageDecoder;
  readonly acp?: AcpProfile;
}

export type ProviderOptions<T> = T extends unknown
  ? Omit<T, "providers"> & { readonly providers?: readonly Provider[] }
  : never;
