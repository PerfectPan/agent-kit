# agent-kit

`@rivus/agent-kit` provides building blocks for applications that work with third-party coding agents such as
Claude Code, Codex and Grok. The kit knows each agent's id and home directory, lists its sessions, and reads their
logs into one transcript model with one usage convention. Files, processes and the environment come from a
`Platform` object that the caller passes in, so the reading code also runs in a browser.

Status: 0.x. A minor release may contain breaking changes.

## Install

```bash
npm install @rivus/agent-kit
```

ESM only, no side effects, Node.js 22.13 or later. Every entry except `/node`, `/node/effect` and `/testing` also
bundles for browsers. Effect entries need the host to install `effect` at exactly the version in
`peerDependencies.effect`; read it with `npm view @rivus/agent-kit peerDependencies.effect`.
The table describes the source API; verify that your chosen npm release exports the entries you need before
adoption. See [Adopting agent-kit](docs/development/adoption.md).

## Entries

The source API has 18 entries in `@rivus/agent-kit` and three in `@rivus/agent-kit-collab` (21 in total).

| Entry                             | Main exports                                                                                      | Runs in                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------- |
| `@rivus/agent-kit/acp`            | `connectAgent`, `probeAgent`, `agentEnv`, `SessionBindingStore` and its Layers | with `effect` and a platform that spawns |
| `@rivus/agent-kit/providers` | `Provider`, `builtinProviders` | anywhere |
| `@rivus/agent-kit/catalog`        | `isBuiltinCodingAgentId`, `Result`, `ok`, `err`, `AgentKitError`, `isAgentKitError` | anywhere                  |
| `@rivus/agent-kit/cost`           | `createPricing`, `summarize`, `priceRecord`, `Pricing` | anywhere, no imports      |
| `@rivus/agent-kit/cost/prices`    | `litellmPrices`, `litellmPricesVersion`: a LiteLLM price snapshot | anywhere, no imports      |
| `@rivus/agent-kit/discovery`      | `detectAgents`, `versionFromOutput`, `ProbeRecipe` | anywhere, with a platform |
| `@rivus/agent-kit/harness`        | Effect: `planInstall`, `applyInstall`, `verify`, `uninstall`, `inventory`, `doctor`, `HarnessLive` | anywhere, with `effect`   |
| `@rivus/agent-kit/harness/events` | `readHookEvent`, `builtinHookDialects`, `LifecycleEvent` | anywhere, no imports      |
| `@rivus/agent-kit/platform`       | `Platform` (type only) | anywhere                  |
| `@rivus/agent-kit/platform/effect` | `PlatformService`                                                                               | anywhere, with `effect`    |
| `@rivus/agent-kit/redact`         | `redact`, `redactText`: hide home path spellings and secret-shaped strings                        | anywhere, no imports      |
| `@rivus/agent-kit/node`           | `createNodePlatform`                                                                              | Node                      |
| `@rivus/agent-kit/node/effect`    | `NodePlatformLive`                                                                                | Node, with `effect`       |
| `@rivus/agent-kit/sessions`       | `listSessions`, `sessionAdapterHome`, `isSessionHead`, `SessionAdapter` | anywhere, with a platform |
| `@rivus/agent-kit/transcript`     | `loadTranscript`, `summarizeSession`, `Transcript`, `TranscriptEvent` | anywhere, with a platform |
| `@rivus/agent-kit/transcript/usage` | `scanUsage`, `isUsageRecord`, `noCacheInputTokens`, `UsageRecord` | anywhere, with a platform; no imports |
| `@rivus/agent-kit/testing` | `createMemoryPlatform`, `sessionAdapterConformance`, `hookDialectConformance`, `probeRecipeConformance` | Node |
| `@rivus/agent-kit/testing/effect` | `aggregateRepositoryConformance` | anywhere, with `effect` |

Collab's entries use agent-kit's public platform and are installed from the same lockstep release:

| Entry                                  | Main exports                                | Calling style           |
| -------------------------------------- | ------------------------------------------- | ----------------------- |
| `@rivus/agent-kit-collab/process-lock` | `acquireProcessLock`, `isProcessLockHeld`   | Plain, with a platform  |
| `@rivus/agent-kit-collab/lease`        | `createLeaseManager` and lease repository Layers | Effect, with a platform |
| `@rivus/agent-kit-collab/lanes`        | `createLanes`                               | Effect, process-local   |

`builtinProviders` from `/providers` exposes each agent's `identity`, `discovery`, `install`, `sessions`,
`usage` and `acp` services when supported. Select a descriptor by `id`, then check the optional service before use.
The ordinary entries share these service objects. Hook commands keep using `builtinHookDialects` from
`/harness/events`, whose isolated build imports nothing and owns separate hook objects.
`/catalog` retains `AgentKitError` and `isAgentKitError` so callers can recognize errors from shell functions.

## Built-in support

| Agent       | identity | discovery | hooks | install | sessions                                 | usage                                   | acp                         |
| ----------- | -------- | --------- | ----- | ------- | ---------------------------------------- | --------------------------------------- | --------------------------- |
| claude-code | yes      | yes       | yes   | yes     | yes                                      | yes                                     | yes                         |
| codex       | yes      | yes       | yes   | yes     | yes                                      | yes                                     | yes                         |
| cursor      | yes      | yes       | yes   | yes     | Session storage has no supported reader. | Usage storage has no supported decoder. | No supported ACP transport. |
| gemini-cli  | yes      | yes       | yes   | yes     | Session storage has no supported reader. | yes                                     | yes                         |
| grok        | yes      | yes       | yes   | yes     | yes                                      | yes                                     | yes                         |
| opencode    | yes      | yes       | yes   | yes     | Session storage has no supported reader. | yes                                     | yes                         |
| pi          | yes      | yes       | yes   | yes     | Session storage has no supported reader. | yes                                     | No supported ACP transport. |

## Usage

```ts
import { createNodePlatform } from "@rivus/agent-kit/node";
import { isSessionHead, listSessions } from "@rivus/agent-kit/sessions";
import { loadTranscript } from "@rivus/agent-kit/transcript";

const platform = createNodePlatform();

for await (const item of listSessions(platform, { agents: ["claude-code", "codex", "grok"] })) {
  if (!isSessionHead(item)) {
    console.warn(`cannot list ${item.ref.path}: ${item.error._tag}`);
    continue;
  }
  const result = await loadTranscript(platform, item.ref);
  if (!result.ok) {
    console.warn(`cannot read ${item.ref.path}: ${result.error._tag}`);
    continue;
  }
  const { events } = result.value;
  const toolCalls = events.filter((event) => event.kind === "tool_call").length;
  console.log(item.ref.agent, item.title ?? item.ref.path, `${events.length} events, ${toolCalls} tool calls`);
}
```

`listSessions` reads only the head and tail of each file. `loadTranscript` reads every file of one session and
returns its ordered `events`, its subagent lanes (`agents`) and the records it skipped. An event's `kind` types its
`payload`: after `event.kind === "tool_call"`, `event.payload` is a `TranscriptEventPayloads["tool_call"]`, and a field an agent adds
beyond its kind's payload type reads as `unknown`. Events reference each other through `agentId`, `parentId`,
`requestId`, `payload.callId` and `shadowedBy`. Usage follows OTel GenAI and the AI
SDK: `inputTokens` includes cache reads and writes, `outputTokens` includes reasoning, and a count the log does not
record is absent, not 0.

### Hook events

`/harness/events` is for hook processes: it is synchronous, does no IO and imports no npm package or Node built-in.

```ts
import { readFileSync } from "node:fs";

import { readHookEvent } from "@rivus/agent-kit/harness/events";

// In a hook command registered for Claude Code; the payload is the JSON the agent wrote to stdin.
const event = readHookEvent("claude-code", JSON.parse(readFileSync(0, "utf8")), process.env);
// { agent: "claude-code", phase: "start", scope: "turn", nativeEvent: "UserPromptSubmit", sessionId, cwd, turnId }
```

`agent` is the agent that really ran the hook: Grok and Cursor also run the hooks in Claude Code's settings. `phase`
is `start`, `activity`, `blocked`, `finish` or `unknown`, with `scope`, `outcome` and `blocker` where the agent says
more; a payload or event the dialect does not know reads as `unknown` instead of throwing. Tool arguments are never
copied, only the tool's name and call id. `terminal` names the herdr, cmux, Superset or tmux pane the hook ran in.
`builtinHookDialects` holds each agent's hook facts: event names, the timeout unit, which events are permission
gates and what an observing hook should print.

### Usage records

`/transcript/usage` decodes token usage without building transcripts, and imports nothing outside the package, so a
host that cannot install dependencies can bundle it alone. `scanUsage` reads every agent's usage under its home and
returns a state to pass to the next scan, which then reads only what was written since:

```ts
import { createNodePlatform } from "@rivus/agent-kit/node";
import { isUsageRecord, scanUsage, type UsageRecord } from "@rivus/agent-kit/transcript/usage";
type UsageScanState = ReturnType<typeof scanUsage>["state"];

const platform = createNodePlatform();
const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
let state: UsageScanState | undefined; // keep it between runs, as JSON
const records: UsageRecord[] = []; // a continued scan yields only new records: keep records with the state

const scan = scanUsage(platform, { since, ...(state ? { state } : {}) });
for await (const item of scan) {
  if (isUsageRecord(item)) {
    records.push(item);
  }
}
state = scan.state;
```

A `UsageRecord` is one model request (`granularity: "request"`), or a turn when the agent logs only turn totals (Grok,
with `modelCalls` and `usageByModel`); it carries the agent's own cost when the log has one (`costUsd`,
`costSource: "agent"`) and a `pricingMultiplier` for Codex's priority tier. A request that several files hold (a Claude
Code subagent file that starts with a copy of another's records, an older Gemini CLI chat migrated into a `.jsonl`
file) counts once. Claude Code writes a response as several records, so the last requests of a session that is still
running wait in the state; a scan reports them once their file has been quiet for 30 minutes. A scan that continues
from a state needs `since`: the state keeps a cursor per source (by an identity that survives Codex archiving) and a
short hash of every request counted since then, about 1 MB for a busy month.

For direct source decoding, select a descriptor's `usage` service and call its `sources` and `decode` methods.
Resolve its home with `sessionAdapterHome(usage, { home, env })`; this helper also accepts a usage service:

```ts
import { createNodePlatform } from "@rivus/agent-kit/node";
import { builtinProviders } from "@rivus/agent-kit/providers";
import { sessionAdapterHome } from "@rivus/agent-kit/sessions";

const platform = createNodePlatform();
const usage = builtinProviders.find(({ id }) => id === "codex")?.usage;
if (usage) {
  const { home, env } = platform;
  const agentHome = sessionAdapterHome(usage, { home, env });
  for await (const source of usage.sources(platform, agentHome)) {
    if ("error" in source) {
      throw source.error;
    }
    for await (const item of usage.decode(platform, source)) {
      console.log(item);
    }
  }
}
```

The decoder's cursor continues a source; `scanUsage` manages those cursors for scans across agents.
OpenCode's SQLite store needs `platform.sqlite`; without it a scan yields `SqliteUnavailable`.

### Cost

`/cost` prices usage records with a table you pass in, in USD per million tokens: your own, or the LiteLLM snapshot
from [`/cost/prices`](#cost-prices). It is pure computation and imports nothing.

```ts
import { createPricing, priceRecord, summarize } from "@rivus/agent-kit/cost";
import { createNodePlatform } from "@rivus/agent-kit/node";
import { isUsageRecord, scanUsage, type UsageRecord } from "@rivus/agent-kit/transcript/usage";

const pricing = createPricing(
  { "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, cacheWrite1h: 10 } },
  { fallback: { opus: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 } } }
);
const start = new Date();
start.setHours(0, 0, 0, 0);
start.setDate(start.getDate() - 6);
const week = { since: start.getTime(), until: Date.now() };
const records: UsageRecord[] = [];
for await (const item of scanUsage(createNodePlatform(), week)) {
  if (isUsageRecord(item)) {
    records.push(item);
  }
}
const { total, groups } = summarize(records, pricing, { window: week, groupBy: ["agent"] });
```

`summarize` prices each record using the amount the agent logged when there is one (Pi, opencode,
Grok), otherwise each count at the model's price (input without cache, cache reads, 5-minute and 1-hour cache writes,
output) times the record's `pricingMultiplier` (2 for Codex's priority tier). Keys match regardless of case. A table
key names one model: it prices that id, the id followed by a date (`-20250929`, `-2025-08-07` or Vertex AI's
`@20250929`), and either after one `<provider>/` prefix, so `claude-sonnet-4-5` prices `claude-sonnet-4-5-20250929`
and `anthropic/claude-sonnet-4-5`; any other ending names another model, so `gpt-5` prices neither `gpt-5.7` nor
`gpt-5-codex`. `fallback` holds family aliases such as `opus`: an id that no table key matches takes the longest alias
its id contains. `overrides` are your own rules and, unlike table keys, match by substring: an id takes the longest
override key it contains, and that override replaces its prices, also in part, over the table and the fallback. So
`{ opus: … }` reprices both `claude-opus-4-8` and `claude-3-opus`, and `{ "gpt-4o": … }` also reaches `gpt-4o-mini`.
A partial override takes the prices it lacks from the id's price without overrides: over the snapshot,
`{ "gpt-4o": { input: 1 } }` prices `gpt-4o-2024-05-13` at its own output price ($15), not `gpt-4o`'s ($10), and an
id without a price of its own stays unpriced. A model without a price has no cost (`undefined`, not 0), and a
summary's `costUsd` is absent when nothing in it was priced. A Grok turn split by model is priced and grouped per
model.

`priceRecord(record, pricing): PricedRecord` prices one record by the same rules, for a host that adds records to
buckets of its own, such as hours. It returns `{ parts }`: one part per model when the record is split by model
(`usageByModel`), else one part for the whole record. A part has the `model` (absent when the record names none), its
`usage`, its `modelCalls` when it counts them, and its `cost`: `{ costUsd, costSource }`, where `costSource` is
`"agent"` for an amount the agent logged and `"pricing-table"` for one computed from the table. A part that nothing
prices has no `cost`, which is not a cost of 0. The parts' costs, added up per agent and model, are `summarize`'s
groups. A part of a split has only the `modelCalls` of its model's share, never the record's: a share that counts none
gives a part without `modelCalls`, so the parts can add up to fewer calls than `record.modelCalls`. A host that counts
calls per record reads `record.modelCalls` and decides how to divide them among the models.

```ts
for (const record of records) {
  for (const { model, usage, modelCalls, cost } of priceRecord(record, pricing).parts) {
    // Add usage, modelCalls and cost?.costUsd to the bucket of (the hour of record.timestamp, record.agent, model).
  }
  // The parts' modelCalls can add up to less than record.modelCalls, which a host counting calls per record reads.
}
```

### Cost prices

`/cost/prices` is the kit's snapshot of LiteLLM's
[model price list](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json) for the models
the supported agents record. `litellmPrices` is a table for `createPricing`. `litellmPricesVersion` is
`<date>+<commit>`: the date (UTC) and commit of LiteLLM's file the snapshot was generated from. Store it with the costs
you compute to know which table priced them. The entry imports nothing and is kept apart from `/cost`, so a host that
brings its own table does not load this one.

```ts
import { createPricing, summarize } from "@rivus/agent-kit/cost";
import { litellmPrices, litellmPricesVersion } from "@rivus/agent-kit/cost/prices";

const pricing = createPricing(litellmPrices);
const { total } = summarize(records, pricing);
// Keep { costUsd: total.costUsd, pricedWith: litellmPricesVersion } together.
```

The snapshot keeps the chat models of the providers whose own APIs the agents call: Anthropic, OpenAI, Google Gemini,
xAI, DeepSeek, Z.ai, Moonshot and MiniMax. Its keys are LiteLLM's model names without the provider's own prefix
(`grok-4.20`, not `xai/grok-4.20`), because agents record the bare name; the same models routed through clouds and
gateways (`bedrock/…`, `vertex_ai/…`, `openrouter/…`) are left out. Each entry has the input, output, cache write,
one-hour cache write and cache read prices that LiteLLM lists. `scripts/update-pricing.ts` regenerates the snapshot,
and [`scripts/lib/litellm-snapshot.ts`](scripts/lib/litellm-snapshot.ts) documents the filter. Every Monday a
workflow opens a pull request when a price the snapshot keeps has changed, and the next release ships it.

Each key names one model, so an id the snapshot has no key for has no price rather than another model's: until the
snapshot has `gpt-5.7`, it is unpriced, not priced as `gpt-5`. A host that wants an estimate for such ids passes
family aliases in `fallback`, at prices it chooses, or prices the ids with `overrides`. Overrides still match by
substring, because the host writes them: a full override keyed `gpt-5` prices `gpt-5.7` and reprices every model the
snapshot names whose id contains `gpt-5`; a partial one reprices those models but leaves `gpt-5.7`, which has no price
of its own to fill it, unpriced.

## Errors

- `loadTranscript` and `summarizeSession` resolve to a `Result`: `{ ok: true, value }` or `{ ok: false, error }`, where
  `error._tag` names the failure. `loadTranscript` and `summarizeSession` fail with `SessionNotFound`, `ReadFailed`,
  `UnknownFormatGeneration`, `NoAdapterAccepted` or `CapabilityUnsupported`.
- `detectAgents` resolves to `Installation[]`; a failed probe is recorded in that agent's `problems`.
- `listSessions` yields `{ ref, error }` for a missing root (`RootMissing`) or an unreadable file (`ReadFailed`) and
  goes on with the next one; `scanUsage` yields `{ agent, path, error }` items the same way.
- When the `signal` option aborts, the call rejects with `signal.reason`.
- Programming errors and defects throw. Naming an agent without a session adapter in `listSessions({ agents })`, or
  without a hook dialect in `readHookEvent`, throws an `AgentKitError` with `code: "capability-unsupported"`; test
  for it with `isAgentKitError`. `readHookEvent` never throws because of a payload.

## Agents

| Agent       | Id                              | Home: override, default                                 |
| ----------- | ------------------------------- | ------------------------------------------------------- |
| Claude Code | `claude-code` (alias `claude`)  | `CLAUDE_CONFIG_DIR`, `~/.claude`                        |
| Codex       | `codex`                         | `CODEX_HOME`, `~/.codex` (archived sessions included)   |
| Grok        | `grok`                          | `GROK_HOME`, `~/.grok`                                  |
| Gemini CLI  | `gemini-cli` (alias `gemini`)   | `GEMINI_CLI_HOME` replaces the user's home, `~/.gemini` |
| opencode    | `opencode`                      | `$XDG_DATA_HOME/opencode`, `~/.local/share/opencode`    |
| Pi          | `pi`                            | `PI_CODING_AGENT_DIR` (expands `~`), `~/.pi/agent`      |
| Cursor      | `cursor` (alias `cursor-agent`) | none: `CURSOR_CONFIG_DIR`, `$XDG_CONFIG_HOME/cursor`, `~/.cursor` |

Every agent in the table has a hook dialect in `/harness/events`. `/transcript/usage` reads the usage of every agent in the table except
Cursor.

Routed functions accept `providers?: readonly Provider[]` (the type and `builtinProviders` come from
`@rivus/agent-kit/providers`). Descriptors merge over built-ins by id and service: `{ id: "codex", hooks: dialect }`
changes only Codex hooks. Omitted services and other agents remain available; the old `adapters`, `dialects`,
`recipes` and `profiles` options are removed. A custom `identity` supplies aliases and a fallback home rule;
conflicting aliases or an identity whose id differs from its descriptor are rejected. To display an agent name,
find `builtinProviders.find((provider) => provider.id === id)?.identity?.displayName`. To customize discovery,
select its `discovery` recipe and pass `providers: [{ id, discovery: { ...recipe, auth: {} } }]`.
Option and result types without named consumers remain in signatures; derive them with `Parameters` or
`ReturnType` (and Effect's success/error types for Effect operations).

To read another agent, pass `providers: [{ id: "my-agent", sessions: adapter }]` and check it with `sessionAdapterConformance` from `/testing`.
An adapter's event builder that is generic over the kind takes its payload as `TranscriptEventPayloads[K]`
(exported from `/transcript`) and returns a `TranscriptEventOf<K>`.

`detectAgents(platform)` from `/discovery` reports, for each of the seven agents above, whether it is `runnable`,
`found`, `missing` or `unknown`, with the evidence, the version its command printed and the login state. By default
the login state comes only from credential files and environment variables, without running anything and without
returning secret values; `authProbe: "commands"` also runs the agents' own status commands, whose side effects each
recipe lists. Version probes run by default and make an agent `runnable`; `versionProbe: false` runs nothing at all.
Commands run without a shell and with a time limit; a check that fails is reported in `problems`.
`builtinProviders` has an identity for each of them, and a home rule for each one except Cursor.
Configuration evidence comes from agent-owned session stores, application state or credential files. Installing
hooks, plugins or skills alone does not make an agent `found`; shared hook/MCP settings and agent home directories
do not count.
See [discovery evidence](packages/discovery/README.md) for the paths and their environment overrides.

[`@rivus/agent-kit-collab`](packages/agent-kit-collab/README.md), in the same lockstep release policy, adds fenced
leases (`/lease`, an Effect entry) and single-instance process locks (`/process-lock`) on top of the same platform,
and keyed scheduling lanes (`/lanes`, an Effect entry) with a global concurrency cap and a bounded queue. ACP is
implemented in `/acp`.

`/harness` installs an application's hooks and skills into these agents and removes them again, with a ledger of
what it wrote; see [packages/agent-kit/README.md](packages/agent-kit/README.md#harness-injection).

## Repository

A pnpm workspace monorepo laid out like
[PerfectPan/project-template-pnpm](https://github.com/PerfectPan/project-template-pnpm). Each bounded context is a
private package under `packages/`; `packages/agent-kit` is the published shell that re-exports their public names
and bundles them into `dist`. `infra/architecture/boundaries.ts` declares which package and layer may import what,
and `vp lint` checks every package's imports against it.

```bash
pnpm install
pnpm run check   # format, build, lint, typecheck, test, package checks
```

- [`docs/architecture/authoring.md`](docs/architecture/authoring.md): how to write a context package.
- [`docs/development/adoption.md`](docs/development/adoption.md): application migration, verification and rollback.
- [`CONTEXT.md`](CONTEXT.md): glossary.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`docs/development/release.md`](docs/development/release.md): workflow and
  releases.

## License

MIT. See [LICENSE](LICENSE).
