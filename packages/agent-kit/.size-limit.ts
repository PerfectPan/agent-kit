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
  // The LiteLLM adapter parses the price list with zod/mini, bundled into the entry: about 6.6 kB.
  { name: "@rivus/agent-kit/cost", path: "dist/cost.js", import: "*", limit: "6.75 kB" },
  { name: "@rivus/agent-kit/discovery", path: "dist/discovery.js", import: "*", limit: "12 kB" },
  // About 25 kB of the kit's own code; the rest is its editors, @decimalturn/toml-patch (about 38 kB) and zod/mini
  // (about 5 kB) above all.
  { name: "@rivus/agent-kit/harness", path: "dist/harness.js", import: "*", limit: "78 kB" },
  // The entry keeps parsing to zod schemas, so it now carries zod/mini, bundled in by tsdown.
  { name: "@rivus/agent-kit/harness/events", path: "dist/harness/events.js", import: "*", limit: "8.25 kB" },
  // The Node platform parses system-error codes with zod/mini, which size-limit counts into the entry.
  { name: "@rivus/agent-kit/node", path: "dist/node.js", import: "*", limit: "6.25 kB", ...nodeOnly },
  { name: "@rivus/agent-kit/node/effect", path: "dist/node/effect.js", import: "*", limit: "6.25 kB", ...nodeOnly },
  { name: "@rivus/agent-kit/platform", path: "dist/platform.js", import: "*", limit: "1 kB" },
  { name: "@rivus/agent-kit/platform/effect", path: "dist/platform/effect.js", import: "*", limit: "0.5 kB" },
  { name: "@rivus/agent-kit/redact", path: "dist/redact.js", import: "*", limit: "1.5 kB" },
  // Size-limit counts dependencies, and the log readers now import zod/mini, which the sessions and transcript
  // graphs did not pull in on main: most of their growth is zod/mini itself, the rest the reader schemas of
  // grok, claude-code and codex. /transcript/usage also carries a bundled copy, since the entry imports nothing
  // and tsdown inlines it. The conformance suites also bundle cost, whose LiteLLM adapter now parses with zod/mini.
  { name: "@rivus/agent-kit/sessions", path: "dist/sessions.js", import: "*", limit: "21.73 kB" },
  { name: "@rivus/agent-kit/testing", path: "dist/testing.js", import: "*", limit: "37.72 kB", ...nodeOnly },
  { name: "@rivus/agent-kit/testing/effect", path: "dist/testing/effect.js", import: "*", limit: "5 kB" },
  { name: "@rivus/agent-kit/transcript", path: "dist/transcript.js", import: "*", limit: "22.87 kB" },
  { name: "@rivus/agent-kit/transcript/usage", path: "dist/transcript/usage.js", import: "*", limit: "19.36 kB" }
] satisfies SizeLimitConfig;
