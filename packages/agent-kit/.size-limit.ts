import type { SizeLimitConfig } from "size-limit";

// Node-only entries import node:* modules, which the default browser-targeted measurement bundle cannot resolve.
const nodeOnly = {
  modifyRolldownConfig: <T extends object>(config?: T): T => ({ ...config, platform: "node" }) as T
};

export default [
  { name: "@rivus/agent-kit/catalog", path: "dist/catalog.js", import: "*", limit: "1 kB" },
  { name: "@rivus/agent-kit/node", path: "dist/node.js", import: "*", limit: "3 kB", ...nodeOnly },
  { name: "@rivus/agent-kit/platform", path: "dist/platform.js", import: "*", limit: "1 kB" },
  { name: "@rivus/agent-kit/sessions", path: "dist/sessions.js", import: "*", limit: "1 kB" },
  { name: "@rivus/agent-kit/testing", path: "dist/testing.js", import: "*", limit: "1 kB", ...nodeOnly },
  { name: "@rivus/agent-kit/transcript", path: "dist/transcript.js", import: "*", limit: "1 kB" }
] satisfies SizeLimitConfig;
