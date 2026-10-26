import type { Capability, SupportRow } from "../landing/index.ts";

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

export const TOOL_IDS = ["usage", "status", "hook", "editor", "orchestrator", "runner", "viewer"] as const;

export type ToolId = (typeof TOOL_IDS)[number];

export interface ToolPath {
  readonly tool: ToolId;
  readonly fn: LayerFn;
  readonly providerId: string;
  readonly collab: boolean;
}

/** Typical tool → function → provider path drawn on the layer diagram. */
export const TOOL_PATHS: readonly ToolPath[] = [
  { tool: "usage", fn: "scanUsage", providerId: "claude-code", collab: false },
  { tool: "status", fn: "detectAgents", providerId: "claude-code", collab: false },
  { tool: "hook", fn: "readHookEvent", providerId: "claude-code", collab: false },
  { tool: "editor", fn: "connectAgent", providerId: "claude-code", collab: false },
  { tool: "orchestrator", fn: "createLeaseManager", providerId: "claude-code", collab: true },
  { tool: "runner", fn: "createLanes", providerId: "claude-code", collab: true },
  { tool: "viewer", fn: "listSessions", providerId: "claude-code", collab: false }
];

export const DEFAULT_LAYER_PATH: ToolPath = TOOL_PATHS[0]!;

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

function isLayerFn(name: string): name is LayerFn {
  return (CONNECTION_FNS as readonly string[]).includes(name) || (COORDINATION_FNS as readonly string[]).includes(name);
}

export function isCoordinationFn(name: LayerFn): boolean {
  return (COORDINATION_FNS as readonly string[]).includes(name);
}

export function pathForTool(tool: ToolId): ToolPath {
  const path = TOOL_PATHS.find((item) => item.tool === tool);
  if (path === undefined) {
    throw new Error(`No layer path for tool ${tool}`);
  }
  return path;
}

export function pathForFn(name: LayerFn): ToolPath {
  const mapped = TOOL_PATHS.find((item) => item.fn === name);
  if (mapped !== undefined) {
    return mapped;
  }
  const collab = isCoordinationFn(name);
  return {
    tool: collab ? "orchestrator" : DEFAULT_LAYER_PATH.tool,
    fn: name,
    providerId: DEFAULT_LAYER_PATH.providerId,
    collab
  };
}

export function pathForProvider(providerId: string, current: ToolPath): ToolPath {
  if (current.collab) {
    return { ...DEFAULT_LAYER_PATH, providerId, collab: false };
  }
  return { ...current, providerId };
}

export function resolveLayerPath(focus: string | null): ToolPath {
  if (focus === null) {
    return DEFAULT_LAYER_PATH;
  }
  const tool = TOOL_PATHS.find((item) => item.tool === focus);
  if (tool !== undefined) {
    return tool;
  }
  if (isLayerFn(focus)) {
    return pathForFn(focus);
  }
  return pathForProvider(focus, DEFAULT_LAYER_PATH);
}

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
