/** One built-in provider, with a flag per service the support table shows. */
export interface ProviderServices {
  readonly id: string;
  readonly discovery?: unknown;
  readonly hooks?: unknown;
  readonly install?: unknown;
  readonly sessions?: unknown;
  readonly usage?: unknown;
  readonly acp?: unknown;
}

export interface SupportRow {
  readonly id: string;
  readonly discovery: boolean;
  readonly hooks: boolean;
  readonly install: boolean;
  readonly sessions: boolean;
  readonly usage: boolean;
  readonly acp: boolean;
}

export const CAPABILITIES = ["discovery", "hooks", "install", "sessions", "usage", "acp"] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** A service is supported when the provider object has that field. */
export function supportFromProviders(providers: readonly ProviderServices[]): SupportRow[] {
  return providers.map((provider) => ({
    id: provider.id,
    discovery: provider.discovery !== undefined,
    hooks: provider.hooks !== undefined,
    install: provider.install !== undefined,
    sessions: provider.sessions !== undefined,
    usage: provider.usage !== undefined,
    acp: provider.acp !== undefined
  }));
}
