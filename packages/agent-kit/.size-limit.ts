import type { SizeLimitConfig } from "size-limit";

// Node-only entries import node:* modules, which the default browser-targeted measurement bundle cannot resolve.
const nodeOnly = {
  modifyRolldownConfig: <T extends object>(config?: T): T => ({ ...config, platform: "node" }) as T
};

// size-limit leaves peers out of the measurement, so the Effect entries count only the kit's own code and an inlined
// copy of effect would exceed their budgets.
// The service-table bindings add merging, identity validation and catalog lookups. The exact byte budgets for
// providers, ACP, harness, events and sessions include that code, measured with the existing dependencies.
// Packing /providers separately keeps full usage adapters out of /sessions; the resulting chunk layout also
// changes compression of /providers and /acp. Direct defining-file imports also change module order and compression;
// these two budgets match the measured barrel-free output.
// Provider assembly budgets include service tables and shared facts; these limits track measured output
// without extra headroom.
// Importing builtinProviders with /harness or /sessions duplicates built-in implementations, and its adapter
// objects are distinct from the individual built-in exports.
export default [
  { name: "@rivus/agent-kit/providers", path: "dist/providers.js", import: "*", limit: "38603 B" },
  // About 33 kB of it is the ACP SDK, a dependency the measurement includes. The entry and the SDK both parse with
  // zod, which the measurement counts as well, so zod's own growth lands here.
  { name: "@rivus/agent-kit/acp", path: "dist/acp.js", import: "*", limit: "44533 B" },
  { name: "@rivus/agent-kit/catalog", path: "dist/catalog.js", import: "*", limit: "1.5 kB" },
  // The LiteLLM adapter parses the price list with zod/mini, bundled into the entry: about 6.6 kB.
  { name: "@rivus/agent-kit/cost", path: "dist/cost.js", import: "*", limit: "7 kB" },
  { name: "@rivus/agent-kit/discovery", path: "dist/discovery.js", import: "*", limit: "12 kB" },
  // About 25 kB of the kit's own code; the rest is its editors, @decimalturn/toml-patch (about 38 kB) and zod/mini
  // (about 5 kB) above all. The bridges carry the per-event finish selectors and their payload check, and the
  // read-only legacy listing adds the shared legacyTreatment rule and its use case. shell-quote, which reads a hook
  // command's first word for doctor, is counted with the entry. Configuration cleanup also carries the ledger
  // creation proof and its invalidation when the original entries disappear.
  { name: "@rivus/agent-kit/harness", path: "dist/harness.js", import: "*", limit: "82005 B" },
  // The entry keeps parsing to zod schemas, so it now carries zod/mini, bundled in by `vp pack`.
  { name: "@rivus/agent-kit/harness/events", path: "dist/harness/events.js", import: "*", limit: "8465 B" },
  // The Node platform parses system-error codes with zod/mini, which size-limit counts into the entry.
  { name: "@rivus/agent-kit/node", path: "dist/node.js", import: "*", limit: "6.25 kB", ...nodeOnly },
  { name: "@rivus/agent-kit/node/effect", path: "dist/node/effect.js", import: "*", limit: "6.25 kB", ...nodeOnly },
  { name: "@rivus/agent-kit/platform", path: "dist/platform.js", import: "*", limit: "1 kB" },
  { name: "@rivus/agent-kit/platform/effect", path: "dist/platform/effect.js", import: "*", limit: "0.5 kB" },
  { name: "@rivus/agent-kit/redact", path: "dist/redact.js", import: "*", limit: "1.5 kB" },
  // Size-limit counts dependencies, and the log readers now import zod/mini, which the sessions and transcript
  // graphs did not pull in on main: most of their growth is zod/mini itself, the rest the reader schemas of
  // grok, claude-code and codex. /transcript/usage also carries a bundled copy, since the entry imports nothing
  // and `vp pack` inlines it. The conformance suites also bundle cost, whose LiteLLM adapter now parses with zod/mini.
  // The claude-code summarize pass, the streaming time merge and the prompts rule grow /sessions and /transcript,
  // and the prompts conformance check grows /testing; the Codex and Grok passes and their shared record dispatches
  // grow all three.
  { name: "@rivus/agent-kit/sessions", path: "dist/sessions.js", import: "*", limit: "24476 B" },
  { name: "@rivus/agent-kit/testing", path: "dist/testing.js", import: "*", limit: "40.4 kB", ...nodeOnly },
  { name: "@rivus/agent-kit/testing/effect", path: "dist/testing/effect.js", import: "*", limit: "5 kB" },
  { name: "@rivus/agent-kit/transcript", path: "dist/transcript.js", import: "*", limit: "25622 B" },
  { name: "@rivus/agent-kit/transcript/usage", path: "dist/transcript/usage.js", import: "*", limit: "19434 B" }
] satisfies SizeLimitConfig;
