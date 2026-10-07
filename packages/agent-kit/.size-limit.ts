import type { SizeLimitConfig } from "size-limit";

// Node-only entries import node:* modules, which the default browser-targeted measurement bundle cannot resolve.
const nodeOnly = {
  modifyRolldownConfig: <T extends object>(config?: T): T => ({ ...config, platform: "node" }) as T
};

// size-limit leaves peers out of the measurement, so the Effect entries count only the kit's own code and an inlined
// copy of effect would exceed their budgets.
export default [
  { name: "@rivus/agent-kit/catalog", path: "dist/catalog.js", import: "*", limit: "1.5 kB" },
  { name: "@rivus/agent-kit/cost", path: "dist/cost.js", import: "*", limit: "2 kB" },
  { name: "@rivus/agent-kit/discovery", path: "dist/discovery.js", import: "*", limit: "12 kB" },
  { name: "@rivus/agent-kit/harness/events", path: "dist/harness/events.js", import: "*", limit: "4.8 kB" },
  { name: "@rivus/agent-kit/node", path: "dist/node.js", import: "*", limit: "3 kB", ...nodeOnly },
  { name: "@rivus/agent-kit/node/effect", path: "dist/node/effect.js", import: "*", limit: "3 kB", ...nodeOnly },
  { name: "@rivus/agent-kit/platform", path: "dist/platform.js", import: "*", limit: "1 kB" },
  { name: "@rivus/agent-kit/platform/effect", path: "dist/platform/effect.js", import: "*", limit: "0.5 kB" },
  { name: "@rivus/agent-kit/sessions", path: "dist/sessions.js", import: "*", limit: "14.5 kB" },
  { name: "@rivus/agent-kit/testing", path: "dist/testing.js", import: "*", limit: "35.5 kB", ...nodeOnly },
  { name: "@rivus/agent-kit/transcript", path: "dist/transcript.js", import: "*", limit: "15 kB" },
  { name: "@rivus/agent-kit/transcript/usage", path: "dist/transcript/usage.js", import: "*", limit: "12 kB" }
] satisfies SizeLimitConfig;
