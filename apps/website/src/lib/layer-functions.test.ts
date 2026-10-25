import { expect, it } from "vite-plus/test";

import { CONNECTION_FNS, COORDINATION_FNS, layerFnCapability, providerSupportsLayerFn } from "./layer-functions.ts";
import type { SupportRow } from "./support.ts";

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
