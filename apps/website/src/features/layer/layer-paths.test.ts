import { expect, it } from "vite-plus/test";

import {
  CONNECTION_FNS,
  COORDINATION_FNS,
  DEFAULT_LAYER_PATH,
  TOOL_IDS,
  TOOL_PATHS,
  layerFnCapability,
  pathForFn,
  pathForProvider,
  pathForTool,
  providerSupportsLayerFn,
  resolveLayerPath
} from "./layer-paths.ts";
import type { SupportRow } from "../landing/index.ts";

const cursor: SupportRow = {
  id: "cursor",
  discovery: true,
  hooks: true,
  install: true,
  sessions: false,
  usage: false,
  acp: false
};

const grok: SupportRow = {
  id: "grok",
  discovery: true,
  hooks: true,
  install: true,
  sessions: true,
  usage: true,
  acp: true
};

it("maps each connection function to its capability", () => {
  expect(layerFnCapability("detectAgents")).toBe("discovery");
  expect(layerFnCapability("listSessions")).toBe("sessions");
  expect(layerFnCapability("loadTranscript")).toBe("sessions");
  expect(layerFnCapability("scanUsage")).toBe("usage");
  expect(layerFnCapability("summarize")).toBe("usage");
  expect(layerFnCapability("readHookEvent")).toBe("hooks");
  expect(layerFnCapability("planInstall")).toBe("install");
  expect(layerFnCapability("connectAgent")).toBe("acp");
  expect(layerFnCapability("redactText")).toBeNull();
});

it("treats collab functions as independent of an Agent", () => {
  for (const name of COORDINATION_FNS) {
    expect(layerFnCapability(name)).toBeNull();
    expect(providerSupportsLayerFn(cursor, name)).toBe(true);
  }
});

it("lights only providers that expose the hovered capability", () => {
  expect(providerSupportsLayerFn(cursor, "listSessions")).toBe(false);
  expect(providerSupportsLayerFn(grok, "listSessions")).toBe(true);
  expect(providerSupportsLayerFn(cursor, "detectAgents")).toBe(true);
  expect(providerSupportsLayerFn(cursor, "redactText")).toBe(true);
});

it("covers every function chip on the diagram", () => {
  expect(CONNECTION_FNS).toHaveLength(9);
  expect(COORDINATION_FNS).toHaveLength(3);
});

it("maps each tool to a typical function and provider path", () => {
  expect(TOOL_PATHS.map((path) => path.tool)).toEqual([...TOOL_IDS]);
  expect(pathForTool("usage")).toEqual({
    tool: "usage",
    fn: "scanUsage",
    providerId: "claude-code",
    collab: false
  });
  expect(pathForTool("orchestrator")).toEqual({
    tool: "orchestrator",
    fn: "createLeaseManager",
    providerId: "claude-code",
    collab: true
  });
  expect(pathForTool("runner")).toEqual({
    tool: "runner",
    fn: "createLanes",
    providerId: "claude-code",
    collab: true
  });
  expect(pathForFn("planInstall")).toEqual({
    tool: "usage",
    fn: "planInstall",
    providerId: "claude-code",
    collab: false
  });
  expect(DEFAULT_LAYER_PATH.fn).toBe("scanUsage");
  expect(pathForFn("scanUsage")).toEqual(pathForTool("usage"));
  expect(pathForFn("createLanes")).toEqual(pathForTool("runner"));
  expect(pathForFn("redactText")).toEqual({
    tool: "usage",
    fn: "redactText",
    providerId: "claude-code",
    collab: false
  });
  expect(pathForProvider("codex", pathForTool("usage"))).toEqual({
    tool: "usage",
    fn: "scanUsage",
    providerId: "codex",
    collab: false
  });
  expect(pathForProvider("codex", pathForTool("orchestrator"))).toEqual({
    ...DEFAULT_LAYER_PATH,
    providerId: "codex",
    collab: false
  });
  expect(resolveLayerPath(null)).toEqual(DEFAULT_LAYER_PATH);
  expect(resolveLayerPath("hook")).toEqual(pathForTool("hook"));
  expect(resolveLayerPath("listSessions")).toEqual(pathForTool("viewer"));
  expect(resolveLayerPath("codex").providerId).toBe("codex");
});
