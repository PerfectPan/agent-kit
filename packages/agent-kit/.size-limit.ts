import type { SizeLimitConfig } from "size-limit";

// Node-only entries import node:* modules, which the default browser-targeted measurement bundle cannot resolve.
const nodeOnly = {
  modifyRolldownConfig: <T extends object>(config?: T): T => ({ ...config, platform: "node" }) as T
};

// size-limit leaves peers out of the measurement, so the Effect entries count only the kit's own code and an inlined
// copy of effect would exceed their budgets.
// The service-table bindings add merging, identity validation and catalog lookups. The exact byte budgets for
// providers, ACP, harness, events and sessions include that code, measured with the existing dependencies.
// Descriptors share ordinary-entry chunks and service references. Direct ESM loading can reach additional service
// code through those chunks; size-limit rebundles and tree-shakes each entry before compression.
// `pnpm size:update` sets every limit to the measured size plus headroom (scripts/lib/size-budgets.ts); do not edit them
// by hand.
export default [
  { name: "@rivus/agent-kit/providers", path: "dist/providers.js", import: "*", limit: "67317 B" },
  // About 33 kB of it is the ACP SDK, a dependency the measurement includes. The entry and the SDK both parse with
  // zod, which the measurement counts as well, so zod's own growth lands here.
  { name: "@rivus/agent-kit/acp", path: "dist/acp.js", import: "*", limit: "46354 B" },
  { name: "@rivus/agent-kit/catalog", path: "dist/catalog.js", import: "*", limit: "1115 B" },
  // Pricing and summarization are pure; their entry imports nothing.
  { name: "@rivus/agent-kit/cost", path: "dist/cost.js", import: "*", limit: "1579 B" },
  // Nearly all of it is the LiteLLM snapshot, about 10 B a model plus each model's long-context tier. The budget
  // still fails when the filter admits another provider's routes or the entry starts bundling zod/mini.
  { name: "@rivus/agent-kit/cost/prices", path: "dist/cost/prices.js", import: "*", limit: "3681 B" },
  { name: "@rivus/agent-kit/discovery", path: "dist/discovery.js", import: "*", limit: "13161 B" },
  // About 25 kB of the kit's own code; the rest is its editors, @decimalturn/toml-patch (about 40 kB) and zod/mini
  // (about 5 kB) above all. The bridges carry the per-event finish selectors and their payload check, and the
  // read-only legacy listing adds the shared legacyTreatment rule and its use case. shell-quote, which reads a hook
  // command's first word for doctor, is counted with the entry. Configuration cleanup also carries the ledger
  // creation proof and its invalidation when the original entries disappear. Install-plan and bundle values own
  // validation and copy their inputs before freezing; legacy command content is parsed at the application boundary.
  { name: "@rivus/agent-kit/harness", path: "dist/harness.js", import: "*", limit: "90378 B" },
  // The entry keeps parsing to zod schemas, so it now carries zod/mini, bundled in by `vp pack`.
  { name: "@rivus/agent-kit/harness/events", path: "dist/harness/events.js", import: "*", limit: "9123 B" },
  // The Node platform parses system-error codes with zod/mini, which size-limit counts into the entry.
  { name: "@rivus/agent-kit/node", path: "dist/node.js", import: "*", limit: "6507 B", ...nodeOnly },
  { name: "@rivus/agent-kit/node/effect", path: "dist/node/effect.js", import: "*", limit: "6584 B", ...nodeOnly },
  { name: "@rivus/agent-kit/platform", path: "dist/platform.js", import: "*", limit: "393 B" },
  { name: "@rivus/agent-kit/platform/effect", path: "dist/platform/effect.js", import: "*", limit: "472 B" },
  // The hidden spellings' starts accept preceding escapes — JSON, URL encoding and ANSI SGR sequences — which adds
  // alternation branches to the built regexes, and the credential shapes (provider prefixes, JWTs, Slack webhooks,
  // labelled assignments, authorization values and URL passwords) add their patterns and the filters that keep code.
  // The spellings as text, for a home that a cut left partial at the end, add their builders and the end check.
  { name: "@rivus/agent-kit/redact", path: "dist/redact.js", import: "*", limit: "2714 B" },
  // Size-limit counts dependencies, and the log readers now import zod/mini, which the sessions and transcript
  // graphs did not pull in on main: most of their growth is zod/mini itself, the rest the reader schemas of
  // grok, claude-code and codex. /transcript/usage also carries a bundled copy, since the entry imports nothing
  // and `vp pack` inlines it. The conformance suites also bundle cost, whose LiteLLM adapter now parses with zod/mini.
  // The claude-code summarize pass, the streaming time merge and the prompts rule grow /sessions and /transcript,
  // and the prompts conformance check grows /testing; the Codex and Grok passes and their shared record dispatches
  // grow all three.
  { name: "@rivus/agent-kit/sessions", path: "dist/sessions.js", import: "*", limit: "46519 B" },
  { name: "@rivus/agent-kit/testing", path: "dist/testing.js", import: "*", limit: "25169 B", ...nodeOnly },
  { name: "@rivus/agent-kit/testing/effect", path: "dist/testing/effect.js", import: "*", limit: "2479 B" },
  { name: "@rivus/agent-kit/transcript", path: "dist/transcript.js", import: "*", limit: "46225 B" },
  { name: "@rivus/agent-kit/transcript/usage", path: "dist/transcript/usage.js", import: "*", limit: "25182 B" }
] satisfies SizeLimitConfig;
