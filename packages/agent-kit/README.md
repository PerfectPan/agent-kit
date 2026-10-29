# @rivus/agent-kit

Building blocks for applications that work with third-party coding agents such as Claude Code, Codex and Grok. The
kit knows each agent's id and home directory, lists its sessions, and reads their logs into one transcript model
with one usage convention. Files, processes and the environment come from a `Platform` object that the caller
passes in, so the reading code also runs in a browser.

Status: 0.x. A minor release may contain breaking changes.

## Install

```bash
npm install @rivus/agent-kit
```

ESM only, no side effects, Node.js 22.13 or later. Every entry except `/node`, `/node/effect` and `/testing` also
bundles for browsers. Effect entries need the host to install `effect` at exactly the version in
`peerDependencies.effect`; read it with `npm view @rivus/agent-kit peerDependencies.effect`. Plain entries do not
load this optional peer. The entry table's **Runs in** column marks entries that need it with "with `effect`".
The entry table describes the source API. Verify the exports of the npm version you select before adoption; see
[Adopting agent-kit](https://github.com/PerfectPan/agent-kit/blob/main/docs/development/adoption.md) for migration checks and rollback.

## Entries

| Entry                               | Main exports                                                                                                     | Runs in                                  |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `@rivus/agent-kit/acp`              | `connectAgent`, `probeAgent`, `agentEnv`, `SessionBindingStore` and its Layers                                   | with `effect` and a platform that spawns |
| `@rivus/agent-kit/providers`        | `Provider`, `builtinProviders`                                                                                   | anywhere                                 |
| `@rivus/agent-kit/catalog`          | `isBuiltinCodingAgentId`, `Result`, `ok`, `err`, `AgentKitError`, `isAgentKitError`                              | anywhere                                 |
| `@rivus/agent-kit/cost`             | `createPricing`, `summarize`, `priceRecord`, `Pricing`                                                           | anywhere, no imports                     |
| `@rivus/agent-kit/cost/prices`      | `litellmPrices`, `litellmPricesVersion`: a LiteLLM price snapshot                                                | anywhere, no imports                     |
| `@rivus/agent-kit/discovery`        | `detectAgents`, `versionFromOutput`, `ProbeRecipe`                                                               | anywhere, with a platform                |
| `@rivus/agent-kit/harness`          | Effect: `planInstall`, `applyInstall`, `verify`, `uninstall`, `inventory`, `doctor`, `HarnessLive` and its ports | anywhere, with `effect` and a platform   |
| `@rivus/agent-kit/harness/events`   | `readHookEvent`, `builtinHookDialects`, `LifecycleEvent`                                                         | anywhere, no imports                     |
| `@rivus/agent-kit/platform`         | `Platform` (type only)                                                                                           | anywhere                                 |
| `@rivus/agent-kit/redact`           | `redact`, `redactText`: hide home path spellings and secret-shaped strings                                       | anywhere, no imports                     |
| `@rivus/agent-kit/node`             | `createNodePlatform`                                                                                             | Node                                     |
| `@rivus/agent-kit/platform/effect`  | `PlatformService`: the `Platform` as an Effect service                                                           | anywhere, with `effect`                  |
| `@rivus/agent-kit/node/effect`      | `NodePlatformLive`: a Layer that provides `PlatformService` with `createNodePlatform()`                          | Node, with `effect`                      |
| `@rivus/agent-kit/sessions`         | `listSessions`, `sessionAdapterHome`, `isSessionHead`, `SessionAdapter`                                          | anywhere, with a platform                |
| `@rivus/agent-kit/transcript`       | `loadTranscript`, `summarizeSession`, `Transcript`, `TranscriptEvent`                                            | anywhere, with a platform                |
| `@rivus/agent-kit/transcript/usage` | `scanUsage`, `isUsageRecord`, `noCacheInputTokens`, `UsageRecord`                                                | anywhere, with a platform; no imports    |
| `@rivus/agent-kit/testing`          | `createMemoryPlatform`, `sessionAdapterConformance`, `hookDialectConformance`, `probeRecipeConformance`          | Node                                     |
| `@rivus/agent-kit/testing/effect`   | `aggregateRepositoryConformance`: the conformance cases every aggregate repository passes                        | anywhere, with `effect`                  |

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
returns its ordered `events`, its subagent lanes (`agents`) and the records it skipped; it returns the complete
session — there is no live file-following API, and a compaction marks the events it replaced with `shadowedBy` only
after the whole session is read. `summarizeSession` reads the agent's bounded summarize pass where it has one and
folds the loaded transcript otherwise, with the same numbers either way; the pass's memory grows with the session's
requests, lanes and tool calls, not with the file's bytes. It takes `prompts: { limit, maxChars }` to return the
main lane's user prompts in the same read: a record's prompt text joins its own text blocks — not the text the host
adds beside them, and an image block is the user's own — each trimmed, with a blank line between blocks; a record
whose blocks are all host-added text is injected and counts no turn, one whose own text is only whitespace counts a
turn without a prompt; the first `limit` records in transcript order, each capped at `maxChars`. Caps that are not
whole numbers in range throw an `AgentKitError` with `code: "invalid-prompts"`. An event's `kind` types its
`payload`: after `event.kind === "tool_call"`, `event.payload` is a `TranscriptEventPayloads["tool_call"]`, and a field an agent adds
beyond its kind's payload type reads as `unknown`. Events reference each other through `agentId`, `parentId`,
`requestId`, `payload.callId` and `shadowedBy`. Usage follows OTel GenAI and the AI
SDK: `inputTokens` includes cache reads and writes, `outputTokens` includes reasoning, and a count the log does not
record is absent, not 0. `scanUsage` with a kept state yields only what was written since, so a caller that keeps a
state also keeps its own totals beside it, uses one state per window with the same `since`, and runs its scans one
at a time: two concurrent scans from one state both yield the new records.

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
Register observation hooks only on events that are not permission gates, or return the allow response the event's
output rules record; an observer prints the event's `passThrough` — the dialect's unless that event's `output`
overrides it, as Cursor's `beforeSubmitPrompt` printing `{"continue":true}` — and must not silently block a gate.
Each gate's `output` rules decide what its exit codes and stdout do — Cursor's gates block on output the event
cannot read, and what empty output does there is undocumented.
`builtinHookDialects` holds each agent's hook facts: event names, the timeout unit, which events are permission
gates and what an observing hook should print.

### Harness injection

`/harness` installs what an application wants into the agents (hooks and skills for now) and removes it again. It
plans first and changes agent targets only when the plan is applied; an `InstallPlan` is a handle that cannot be
constructed or serialized, `applyInstall` takes only a plan `planInstall` returned and dies with an `AgentKitError`
whose `code` is `"unknown-plan"` otherwise, so a restart re-plans. Every target change is recorded in a ledger
under `$XDG_STATE_HOME/agent-kit/harness` while an SQLite lock is held, so a crash is recovered by probing, not replayed.

```ts
import { applyInstall, HarnessLive, planInstall, uninstall } from "@rivus/agent-kit/harness";
import { NodePlatformLive } from "@rivus/agent-kit/node/effect";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

const bundle = {
  owner: "my-app",
  version: "1.2.0",
  digest: "…",
  // `{agent}` becomes each agent's id; keep the command stable, agents that review hooks ask again when it changes.
  artifacts: [
    {
      type: "hooks",
      command: "/usr/local/bin/my-app-hook {agent}",
      events: { "claude-code": ["Stop"], codex: ["Stop"] }
    }
  ],
  legacyMarkers: ["my-app hook"] // what older versions registered without a ledger is replaced, not duplicated
} as const;

const program = Effect.gen(function* () {
  const plan = yield* planInstall(bundle, { agents: ["claude-code", "codex"] });
  // plan.changes: each file's text before and after; plan.commands; plan.expectedTrustPrompts; plan.notes;
  // plan.droppedHooks. A PlanConflict names, per conflict, the choices that resolve it ("force", "adopt", "backup").
  return yield* applyInstall(plan);
});
await Effect.runPromiseExit(program.pipe(Effect.provide(HarnessLive.pipe(Layer.provideMerge(NodePlatformLive)))));
// Later: uninstall("my-app") removes only what the ledger records and keeps files the user changed.
```

Claude Code gets a skills-dir plugin, Codex a plugin (through `codex plugin`, or `config.toml` hook groups when
`codex` is not on `PATH`), Gemini CLI an extension, Grok a file in `~/.grok/hooks`, Cursor a local plugin, and opencode
and Pi a bridge that forwards their events to the command. Events the dialect reads as ending something (phase
`finish`: opencode `session.idle`, `session.error`, `session.deleted` and `session.status` at idle; Pi `agent_end`,
`agent_settled` and `session_shutdown`) are delivered synchronously: the bridge hands them to the command and waits
for it to exit, at most 5 s, so a finish reaches the command before the next event is forwarded. A send that fails or
times out still does not throw into the agent, and the other events are forwarded without waiting. The timeout kills
the shell the bridge started, so a longer finish hook is cut off, and an activity event forwarded in the same tick
just before a finish can still reach the command after it. The opencode
bridge forwards each bus event as opencode
sent it, plus the plugin's `directory`, and a tool hook as `{ type, properties, directory }`. When an event such as
`file.edited` names no session, it adds `currentSessionId`: the session of the latest event that plugin instance saw
name one, forwarded or not, until that session is deleted. With several sessions in one directory, that is the latest
one's. A payload that throws while it is read does not reject the plugin callback. `readHookEvent` reads
`currentSessionId` after opencode's own session paths, so an event that names a session keeps that id. An event fires
once even in agents that also run Claude Code's settings hooks.
Shared files keep their comments and formatting; nothing is written through a symlink or into a file chezmoi manages.
Concurrent edits by tools that do not take the ledger lock can be lost without a trace. A plan handle cannot be
serialized and applied by a later process: re-plan after a restart, or after `PlanStale` or `TargetChanged`. Planning
may settle an earlier holder's pending operations under the ledger lock, `verify` may acknowledge a ledger that is
behind the disk, and `doctor`'s lock check may create lock files in the harness state directory; none of these
rewrite agent targets.

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
`<date>+<commit>+<digest>`: the date (UTC) and commit of LiteLLM's file the snapshot was generated from, then 12 hex
digits digesting the table's content itself. Store it with the costs you compute: it names the table that priced them,
and it changes whenever that table's content changes — under a new LiteLLM commit, or because the snapshot keeps a
field it did not before — so a stored version that differs from the current one says the stored costs may need
recomputing. The entry imports nothing and is kept apart from `/cost`, so a host that
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
and [`scripts/lib/litellm-snapshot.ts`](https://github.com/PerfectPan/agent-kit/blob/main/scripts/lib/litellm-snapshot.ts) documents the filter. Every Monday a
workflow opens a pull request when a price the snapshot keeps has changed, and the next release ships it.

Each key names one model, so an id the snapshot has no key for has no price rather than another model's: until the
snapshot has `gpt-5.7`, it is unpriced, not priced as `gpt-5`. A host that wants an estimate for such ids passes
family aliases in `fallback`, at prices it chooses, or prices the ids with `overrides`. Overrides still match by
substring, because the host writes them: a full override keyed `gpt-5` prices `gpt-5.7` and reprices every model the
snapshot names whose id contains `gpt-5`; a partial one reprices those models but leaves `gpt-5.7`, which has no price
of its own to fill it, unpriced.

### Effect

Effect entries return Effects and Layers that read the platform from `PlatformService`. Your application provides it
and runs the program; the kit has no Promise wrapper.

```ts
import * as Effect from "effect/Effect";

import { NodePlatformLive } from "@rivus/agent-kit/node/effect";
import { PlatformService } from "@rivus/agent-kit/platform/effect";

const program = Effect.gen(function* () {
  const platform = yield* PlatformService;
  return platform.home;
});
const exit = await Effect.runPromiseExit(program.pipe(Effect.provide(NodePlatformLive)));
```

For another `env` or `home`, provide `Layer.succeed(PlatformService, createNodePlatform({ env, home }))` instead.

### Driving an agent over ACP

`connectAgent` starts an agent's ACP program with exactly the environment you pass, completes the handshake and
returns a connection that belongs to your Scope; closing the Scope closes its sessions and stops the process. A
session runs one turn at a time, and `prompt` streams the turn: deltas named after AI SDK's stream parts
(`text-delta`, `reasoning-delta`, `tool-input-*`, `tool-output-available`, `tool-output-error`, `finish`) and `event` parts carrying the
completed `TranscriptEvent`s.

```ts
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { agentEnv, connectAgent, MemorySessionBindingStoreLive } from "@rivus/agent-kit/acp";
import { NodePlatformLive } from "@rivus/agent-kit/node/effect";
import { builtinProviders } from "@rivus/agent-kit/providers";

const profile = builtinProviders.find((provider) => provider.id === "claude-code")?.acp;
if (!profile) throw new Error("Claude Code ACP is unavailable");

const turn = Effect.scoped(
  Effect.gen(function* () {
    const connection = yield* connectAgent("claude-code", {
      cwd: "/work/project",
      // Only the variables the agent reads; nothing is inherited.
      env: agentEnv(profile, process.env),
      onPermission: (request) => Effect.succeed(askTheUser(request))
    });
    const session = yield* connection.newSession({ sessionKey: "chat:42", systemPrompt: "Be brief." });
    yield* session.prompt([{ type: "text", text: "Summarize README.md" }]).pipe(Stream.runForEach(render));
  })
);
await Effect.runPromiseExit(turn.pipe(Effect.provide(Layer.mergeAll(NodePlatformLive, MemorySessionBindingStoreLive))));
```

Permission requests go to `onPermission`; without it, or without an answer, they are denied. Interrupting a turn's
stream, or `session.cancel()`, sends `session/cancel` and waits for the turn to end within `cancelTimeoutMs` (5 s by
default); when it does not end in time, the session's binding is removed and the connection is closed, which fails its
other sessions with `ConnectionClosed`. `sessionKey` binds a key to the session in the `SessionBindingStore`
(`MemorySessionBindingStoreLive` or `FileSessionBindingStoreLive(path)`), so a later connection can
`loadSession({ sessionKey })`. Client file reads and writes are off unless `fileSystem` turns them on, and then stay
inside the session's directory after links are resolved. `probeAgent` opens one trial session and reports `ready`,
`needs-login` or `unavailable`.

## Errors

- `loadTranscript` and `summarizeSession` resolve to a `Result`: `{ ok: true, value }` or `{ ok: false, error }`, where
  `error._tag` names the failure. `loadTranscript` and `summarizeSession` fail with `SessionNotFound`, `ReadFailed`,
  `UnknownFormatGeneration`, `NoAdapterAccepted` or `CapabilityUnsupported`.
- `detectAgents` resolves to `Installation[]`; a failed probe is recorded in that agent's `problems`.
- `listSessions` yields `{ ref, error }` for a missing root (`RootMissing`) or an unreadable file (`ReadFailed`) and
  goes on with the next one; `scanUsage` yields `{ agent, path, error }` items the same way.
- When the `signal` option aborts, the call rejects with `signal.reason`.
- `/acp` fails Effects with the same kind of `_tag` errors: `AgentUnavailable` and `HandshakeFailed` from
  `connectAgent`; `AuthRequired`, `AcpTimeout`, `AcpRequestFailed`, `ConnectionClosed`, `BindingNotFound`,
  `LoadUnsupported` and `SessionBindingStoreFailure` from opening sessions; `TurnInProgress`, `SessionClosed` and
  `CancelUnsettled` from turns.
- Programming errors and defects throw. Naming an agent without a session adapter in `listSessions({ agents })`, or
  without a hook dialect in `readHookEvent`, throws an `AgentKitError` with `code: "capability-unsupported"`; test
  for it with `isAgentKitError`. `summarizeSession` throws the same way, with `code: "invalid-prompts"`, for
  `prompts` caps that are not whole numbers in range. `readHookEvent` never throws because of a payload.

## Agents

| Agent       | Id                              | Home: override, default                                           |
| ----------- | ------------------------------- | ----------------------------------------------------------------- |
| Claude Code | `claude-code` (alias `claude`)  | `CLAUDE_CONFIG_DIR`, `~/.claude`                                  |
| Codex       | `codex`                         | `CODEX_HOME`, `~/.codex` (archived sessions included)             |
| Grok        | `grok`                          | `GROK_HOME`, `~/.grok`                                            |
| Gemini CLI  | `gemini-cli` (alias `gemini`)   | `GEMINI_CLI_HOME` replaces the user's home, `~/.gemini`           |
| opencode    | `opencode`                      | `$XDG_DATA_HOME/opencode`, `~/.local/share/opencode`              |
| Pi          | `pi`                            | `PI_CODING_AGENT_DIR` (expands `~`), `~/.pi/agent`                |
| Cursor      | `cursor` (alias `cursor-agent`) | none: `CURSOR_CONFIG_DIR`, `$XDG_CONFIG_HOME/cursor`, `~/.cursor` |

Every agent in the table has a hook dialect in `/harness/events`. `/acp` has a launch profile for
Claude Code (`claude-agent-acp`), Codex (`codex-acp`), Gemini CLI, Grok and opencode; a profile's `warnings` name the
facts not yet checked against the agent. `/transcript/usage` reads the usage of every agent in the table except
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
Commands run without a shell and with a time limit; a check that fails is reported in `problems`. `builtinProviders` has an identity for each of them, and a
home rule for each one except Cursor.
Configuration evidence comes from agent-owned session stores, application state or credential files. Agent homes
and shared hook/MCP settings, plugins, extensions and skills do not count: installing hooks alone leaves an
agent `missing`.
See [discovery evidence](https://github.com/PerfectPan/agent-kit/blob/main/packages/discovery/README.md) for paths and overrides.

MIT licensed. Source: [PerfectPan/agent-kit](https://github.com/PerfectPan/agent-kit).
