import type { SizeLimitConfig } from "size-limit";

// Node-only entries import node:* modules, which the default browser-targeted measurement bundle cannot resolve.
const nodeOnly = {
  modifyRolldownConfig: <T extends object>(config?: T): T => ({ ...config, platform: "node" }) as T
};

// size-limit leaves peers out of the measurement, so the Effect entries count only the kit's own code and an inlined
// copy of effect would exceed their budgets.
export default [
  // About 33 kB of it is the ACP SDK, a dependency the measurement includes.
  { name: "@rivus/agent-kit/acp", path: "dist/acp.js", import: "*", limit: "44 kB" },
  { name: "@rivus/agent-kit/catalog", path: "dist/catalog.js", import: "*", limit: "1.5 kB" },
  { name: "@rivus/agent-kit/cost", path: "dist/cost.js", import: "*", limit: "2 kB" },
  { name: "@rivus/agent-kit/discovery", path: "dist/discovery.js", import: "*", limit: "12 kB" },
  // About 25 kB of the kit's own code; the rest is its editors, @decimalturn/toml-patch (about 38 kB) above all.
  { name: "@rivus/agent-kit/harness", path: "dist/harness.js", import: "*", limit: "77 kB" },
  { name: "@rivus/agent-kit/harness/events", path: "dist/harness/events.js", import: "*", limit: "4.8 kB" },
  { name: "@rivus/agent-kit/node", path: "dist/node.js", import: "*", limit: "3 kB", ...nodeOnly },
  { name: "@rivus/agent-kit/node/effect", path: "dist/node/effect.js", import: "*", limit: "3 kB", ...nodeOnly },
  { name: "@rivus/agent-kit/platform", path: "dist/platform.js", import: "*", limit: "1 kB" },
  { name: "@rivus/agent-kit/platform/effect", path: "dist/platform/effect.js", import: "*", limit: "0.5 kB" },
  { name: "@rivus/agent-kit/redact", path: "dist/redact.js", import: "*", limit: "1.5 kB" },
  // The sessions, transcript and transcript/usage budgets include the zod schemas of the usage and record readers.
  // transcript/usage also carries a bundled zod/mini: the entry imports nothing, so tsdown inlines it.
  { name: "@rivus/agent-kit/sessions", path: "dist/sessions.js", import: "*", limit: "17.71 kB" },
  { name: "@rivus/agent-kit/testing", path: "dist/testing.js", import: "*", limit: "35.5 kB", ...nodeOnly },
  { name: "@rivus/agent-kit/testing/effect", path: "dist/testing/effect.js", import: "*", limit: "5 kB" },
  { name: "@rivus/agent-kit/transcript", path: "dist/transcript.js", import: "*", limit: "18.7 kB" },
  { name: "@rivus/agent-kit/transcript/usage", path: "dist/transcript/usage.js", import: "*", limit: "16.91 kB" }
] satisfies SizeLimitConfig;
