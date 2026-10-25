import type { Capability, SupportRow } from "./support.ts";

export const CONNECTION_FNS = [
  "detectAgents",
  "listSessions",
  "loadTranscript",
  "scanUsage",
  "summarize",
  "readHookEvent",
  "planInstall",
  "connectAgent",
  "redactText"
] as const;

export const COORDINATION_FNS = ["acquireProcessLock", "createLeaseManager", "createLanes"] as const;

export type LayerFn = (typeof CONNECTION_FNS)[number] | (typeof COORDINATION_FNS)[number];

const CAPABILITY_BY_FN: Record<LayerFn, Capability | null> = {
  detectAgents: "discovery",
  listSessions: "sessions",
  loadTranscript: "sessions",
  scanUsage: "usage",
  summarize: "usage",
  readHookEvent: "hooks",
  planInstall: "install",
  connectAgent: "acp",
  redactText: null,
  acquireProcessLock: null,
  createLeaseManager: null,
  createLanes: null
};

/** `null` means the function does not depend on an Agent: every provider stays lit. */
export function layerFnCapability(name: LayerFn): Capability | null {
  return CAPABILITY_BY_FN[name];
}

export function providerSupportsLayerFn(row: SupportRow, name: LayerFn): boolean {
  const capability = layerFnCapability(name);
  if (capability === null) {
    return true;
  }
  return row[capability];
}
