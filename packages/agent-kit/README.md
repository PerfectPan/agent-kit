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
bundles for browsers. The Effect entries `/acp`, `/platform/effect` and `/node/effect` need `effect` 4.0.1, an
optional peer that you install yourself (`npm install effect@4.0.1`); no other entry loads it.

## Entries

| Entry                               | Main exports                                                                                                         | Runs in                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `@rivus/agent-kit/acp`              | `connectAgent`, `probeAgent`, `builtinAcpProfiles`, `agentEnv`, `SessionBindingStore` and its Layers                 | with `effect` and a platform that spawns |
| `@rivus/agent-kit/catalog`          | `builtinCodingAgents`, `parseCodingAgentId`, `resolveHome`, `Result`, `AgentKitError`                                | anywhere                                 |
| `@rivus/agent-kit/cost`             | `createPricing`, `costOf`, `calendarWindow`, `summarize`, `fromLiteLLM`                                              | anywhere, no imports                     |
| `@rivus/agent-kit/discovery`        | `detectAgents`, `builtinProbeRecipes`, `classifyInstallation`, `ProbeRecipe`                                         | anywhere, with a platform                |
| `@rivus/agent-kit/harness/events`   | `readHookEvent`, `reduceLifecycle`, `lifecycleStatus`, `heartbeatSignal`, `builtinHookDialects`                      | anywhere, no imports                     |
| `@rivus/agent-kit/platform`         | `Platform` and its port types, `splitLines`                                                                          | anywhere                                 |
| `@rivus/agent-kit/redact`           | `redact`, `redactText`: hide home path spellings and secret-shaped strings                                           | anywhere, no imports                     |
| `@rivus/agent-kit/node`             | `createNodePlatform`                                                                                                 | Node                                     |
| `@rivus/agent-kit/platform/effect`  | `PlatformService`: the `Platform` as an Effect service                                                               | anywhere, with `effect`                  |
| `@rivus/agent-kit/node/effect`      | `NodePlatformLive`: a Layer that provides `PlatformService` with `createNodePlatform()`                              | Node, with `effect`                      |
| `@rivus/agent-kit/sessions`         | `listSessions`, `isSessionHead`, `builtinSessionAdapters`, `SessionAdapter`                                          | anywhere, with a platform                |
| `@rivus/agent-kit/transcript`       | `loadTranscript`, `summarizeSession`, `readOriginal`, `foldTranscript`, `foldStreamParts`, translators, event rules  | anywhere, with a platform                |
| `@rivus/agent-kit/transcript/usage` | `scanUsage`, `decodeUsage`, `listUsageSources`, `addUsage`, `noCacheInputTokens`, `toAiSdkUsage`, `toOtelAttributes` | anywhere, with a platform; no imports    |
| `@rivus/agent-kit/testing`          | `createMemoryPlatform`, `sessionAdapterConformance`, `hookDialectConformance`, `probeRecipeConformance`              | Node                                     |

Each built-in agent has a pure translator, a usage function and a capability list in `/transcript`:
`translateClaudeCodeRecords`, `claudeCodeUsage` and `CLAUDE_CODE_CAPABILITIES`, and the same for Codex
(`translateCodexRecords`, ...) and Grok (`translateGrokRecords`, ...). They need no platform. The event rules
(`isPrompt`, `laneOf`, `mainAgentId`, `requestUsage`, `shadowedIn`, `latestSnapshot`, ...) interpret events without
knowing any agent's log format. `/catalog` also exports `isBuiltinCodingAgentId`, `homeFromRule`, `ok`, `err` and
`isAgentKitError`.

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
returns its ordered `events`, its subagent lanes (`agents`) and the records it skipped. Events reference each other
through `agentId`, `parentId`, `requestId`, `payload.callId` and `shadowedBy`. Usage follows OTel GenAI and the AI
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
`reduceLifecycle(state, event, { ttlMs, now })` folds one session's events into `idle`, `working`, `blocked` or
`unknown`, drops late events of older turns and falls back to `unknown` after the TTL;
`heartbeatSignal(before, after, event)` gives the start / heartbeat / finish reading of a heartbeat-based tracker from
the states around one `reduceLifecycle` step. `builtinHookDialects` holds each agent's hook facts: event names, the
timeout unit, which events are permission gates and what an observing hook should print.

### Usage records

`/transcript/usage` decodes token usage without building transcripts, and imports nothing outside the package, so a
host that cannot install dependencies can bundle it alone. `scanUsage` reads every agent's usage under its home and
returns a state to pass to the next scan, which then reads only what was written since:

```ts
import { createNodePlatform } from "@rivus/agent-kit/node";
import { addUsage, isUsageRecord, scanUsage, type Usage, type UsageScanState } from "@rivus/agent-kit/transcript/usage";

const platform = createNodePlatform();
const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
let state: UsageScanState | undefined; // keep it between runs, as JSON
const totals = new Map<string, Usage>();

const scan = scanUsage(platform, { since, ...(state ? { state } : {}) });
for await (const item of scan) {
  if (isUsageRecord(item)) {
    totals.set(item.agent, addUsage(totals.get(item.agent) ?? {}, item.usage));
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

`decodeUsage(platform, agent, source, { from, since, until, final })` decodes one source as a stream whose `cursor`,
passed back as `from`, continues where it stopped; memory does not grow with the source. Without `final: true` the
requests that may still get records where the file ends stay in the cursor. After `SourceChanged` (the file was
rewritten) the cursor is `undefined`, so the next decode reads the file again. opencode keeps its messages in SQLite,
which needs `platform.sqlite`; without it the decode yields `SqliteUnavailable`.

### Cost

`/cost` prices usage records with a table you pass in, in USD per million tokens; the kit ships no prices. It is pure
computation and imports nothing.

```ts
import { calendarWindow, createPricing, summarize } from "@rivus/agent-kit/cost";
import { createNodePlatform } from "@rivus/agent-kit/node";
import { isUsageRecord, scanUsage, type UsageRecord } from "@rivus/agent-kit/transcript/usage";

const pricing = createPricing(
  { "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, cacheWrite1h: 10 } },
  { fallback: { opus: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 } } }
);
const week = calendarWindow(7, { now: Date.now() }); // today and the six days before, from local midnight
const records: UsageRecord[] = [];
for await (const item of scanUsage(createNodePlatform(), week)) {
  if (isUsageRecord(item)) {
    records.push(item);
  }
}
const { total, groups } = summarize(records, pricing, { window: week, groupBy: ["agent"] });
```

`costOf(record, pricing)` is the cost of one record: the amount the agent logged when there is one (Pi, opencode,
Grok), otherwise each count at the model's price (input without cache, cache reads, 5-minute and 1-hour cache writes,
output) times the record's `pricingMultiplier` (2 for Codex's priority tier). A model takes its own id's entry, else
the longest key its id contains, regardless of case; `overrides` replace a key's prices, also in part, and `fallback`
holds entries such as family aliases. A model without a price has no cost (`undefined`, not 0), and a summary's
`costUsd` is absent when nothing in it was priced. A Grok turn split by model is priced and grouped per model.
`fromLiteLLM(json)` turns LiteLLM's model price list into a table.

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
completed `TranscriptEvent`s. `foldStreamParts` rebuilds those events from the deltas alone.

```ts
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { agentEnv, builtinAcpProfiles, connectAgent, MemorySessionBindingStoreLive } from "@rivus/agent-kit/acp";
import { NodePlatformLive } from "@rivus/agent-kit/node/effect";

const turn = Effect.scoped(
  Effect.gen(function* () {
    const connection = yield* connectAgent("claude-code", {
      cwd: "/work/project",
      // Only the variables the agent reads; nothing is inherited.
      env: agentEnv(builtinAcpProfiles["claude-code"]!, process.env),
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

- A function that returns a `Promise` resolves to a `Result`: `{ ok: true, value }` or `{ ok: false, error }`, where
  `error._tag` names the failure. `loadTranscript` and `summarizeSession` fail with `SessionNotFound`, `ReadFailed`,
  `UnknownFormatGeneration`, `NoAdapterAccepted` or `CapabilityUnsupported`; `readOriginal` fails with
  `SourceChanged`, `SessionNotFound` or `ReadFailed`.
- `listSessions` yields `{ ref, error }` for a missing root (`RootMissing`) or an unreadable file (`ReadFailed`) and
  goes on with the next one; `scanUsage`, `listUsageSources` and `decodeUsage` yield `{ agent, path, error }` items the same way.
- When the `signal` option aborts, the call rejects with `signal.reason`.
- `/acp` fails Effects with the same kind of `_tag` errors: `AgentUnavailable` and `HandshakeFailed` from
  `connectAgent`; `AuthRequired`, `AcpTimeout`, `AcpRequestFailed`, `ConnectionClosed`, `BindingNotFound`,
  `LoadUnsupported` and `SessionBindingStoreFailure` from opening sessions; `TurnInProgress`, `SessionClosed` and
  `CancelUnsettled` from turns.
- Programming errors and defects throw. Naming an agent without a session adapter in `listSessions({ agents })`, or
  without a hook dialect in `readHookEvent`, throws an `AgentKitError` with `code: "capability-unsupported"`; test
  for it with `isAgentKitError`. `readHookEvent` never throws because of a payload.

## Agents

| Agent       | Id                              | Home: override, default                                           | In 0.1.0                 |
| ----------- | ------------------------------- | ----------------------------------------------------------------- | ------------------------ |
| Claude Code | `claude-code` (alias `claude`)  | `CLAUDE_CONFIG_DIR`, `~/.claude`                                  | sessions and transcripts |
| Codex       | `codex`                         | `CODEX_HOME`, `~/.codex` (archived sessions included)             | sessions and transcripts |
| Grok        | `grok`                          | `GROK_HOME`, `~/.grok`                                            | sessions and transcripts |
| Gemini CLI  | `gemini-cli` (alias `gemini`)   | `GEMINI_CLI_HOME` replaces the user's home, `~/.gemini`           | catalog identity only    |
| opencode    | `opencode`                      | `$XDG_DATA_HOME/opencode`, `~/.local/share/opencode`              | catalog identity only    |
| Pi          | `pi`                            | `PI_CODING_AGENT_DIR` (expands `~`), `~/.pi/agent`                | catalog identity only    |
| Cursor      | `cursor` (alias `cursor-agent`) | none: `CURSOR_CONFIG_DIR`, `$XDG_CONFIG_HOME/cursor`, `~/.cursor` | added after 0.1.0        |

Every agent in the table has a hook dialect in `/harness/events` (added after 0.1.0). `/acp` has a launch profile for
Claude Code (`claude-agent-acp`), Codex (`codex-acp`), Gemini CLI, Grok and opencode; a profile's `warnings` name the
facts not yet checked against the agent. `/transcript/usage` reads the usage of every agent in the table except
Cursor (added after 0.1.0).

To read another agent, pass your own `SessionAdapter` through the `adapters` option
(`{ ...builtinSessionAdapters, "my-agent": adapter }`) and check it with `sessionAdapterConformance` from `/testing`.

`detectAgents(platform)` from `/discovery` reports, for each of 27 agents (the seven above, aider, Amp, Antigravity,
Cline, CodeBuddy, Codex Desktop, Command Code, GitHub Copilot, Hermes, Kimi Code CLI, Kiro CLI, Neovate,
OpenClaw, OpenHands, Qoder, Roo Code, Trae, VS Code Copilot, Windsurf and Zencoder), whether it is `runnable`,
`found`, `missing` or `unknown`, with the evidence, the version its command printed and the login state. By default
the login state comes only from credential files and environment variables, without running anything and without
returning secret values; `authProbe: "commands"` also runs the agents' own status commands, whose side effects each
recipe lists. Version probes run by default and make an agent `runnable`; `versionProbe: false` runs nothing at all.
Commands run without a shell and with a time limit; a check that fails is reported in `problems`. `/catalog` has an identity for each of them, and a
home rule where upstream documents one: Cline, CodeBuddy, Codex Desktop, GitHub Copilot, Kimi Code CLI, Kiro CLI,
Neovate, OpenHands and Qoder.

MIT licensed. Source and design documents: [PerfectPan/agent-kit](https://github.com/PerfectPan/agent-kit).
