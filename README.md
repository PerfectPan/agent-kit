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

ESM only, no side effects, Node.js 22.13 or later. Every entry except `/node` and `/testing` also bundles for
browsers.

## Entries

| Entry                         | Main exports                                                                                     | Runs in                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------- |
| `@rivus/agent-kit/catalog`    | `builtinCodingAgents`, `parseCodingAgentId`, `resolveHome`, `Result`, `AgentKitError`            | anywhere                  |
| `@rivus/agent-kit/platform`   | `Platform` and its port types, `splitLines`                                                      | anywhere                  |
| `@rivus/agent-kit/node`       | `createNodePlatform`                                                                             | Node                      |
| `@rivus/agent-kit/sessions`   | `listSessions`, `isSessionHead`, `builtinSessionAdapters`, `SessionAdapter`                      | anywhere, with a platform |
| `@rivus/agent-kit/transcript` | `loadTranscript`, `summarizeSession`, `readOriginal`, `foldTranscript`, translators, event rules | anywhere, with a platform |
| `@rivus/agent-kit/testing`    | `createMemoryPlatform`, `sessionAdapterConformance`, `oversizedSession`                          | Node                      |

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

## Errors

- A function that returns a `Promise` resolves to a `Result`: `{ ok: true, value }` or `{ ok: false, error }`, where
  `error._tag` names the failure. `loadTranscript` and `summarizeSession` fail with `SessionNotFound`, `ReadFailed`,
  `UnknownFormatGeneration`, `NoAdapterAccepted` or `CapabilityUnsupported`; `readOriginal` fails with
  `SourceChanged`, `SessionNotFound` or `ReadFailed`.
- `listSessions` yields `{ ref, error }` for a missing root (`RootMissing`) or an unreadable file (`ReadFailed`) and
  goes on with the next one.
- When the `signal` option aborts, the call rejects with `signal.reason`.
- Programming errors and defects throw. Naming an agent without a session adapter in `listSessions({ agents })`
  throws an `AgentKitError` with `code: "capability-unsupported"`; test for it with `isAgentKitError`.

## Agents

| Agent       | Id                             | Home: override, default                                 | In 0.1.0                 |
| ----------- | ------------------------------ | ------------------------------------------------------- | ------------------------ |
| Claude Code | `claude-code` (alias `claude`) | `CLAUDE_CONFIG_DIR`, `~/.claude`                        | sessions and transcripts |
| Codex       | `codex`                        | `CODEX_HOME`, `~/.codex` (archived sessions included)   | sessions and transcripts |
| Grok        | `grok`                         | `GROK_HOME`, `~/.grok`                                  | sessions and transcripts |
| Gemini CLI  | `gemini-cli` (alias `gemini`)  | `GEMINI_CLI_HOME` replaces the user's home, `~/.gemini` | catalog identity only    |
| opencode    | `opencode`                     | `$XDG_DATA_HOME/opencode`, `~/.local/share/opencode`    | catalog identity only    |
| Pi          | `pi`                           | `PI_CODING_AGENT_DIR` (expands `~`), `~/.pi/agent`      | catalog identity only    |

To read another agent, pass your own `SessionAdapter` through the `adapters` option
(`{ ...builtinSessionAdapters, "my-agent": adapter }`) and check it with `sessionAdapterConformance` from `/testing`.

Discovery, usage decoding and cost, harness (injection and hook events), ACP and redaction come in later releases,
as does `@rivus/agent-kit-collab` (leases, process locks, lanes); see
[plan 6.3](docs/plans/0001-agent-kit.md#63-phases-and-tasks) for the phases.

## Repository

A Rush + pnpm monorepo generated from
[PerfectPan/project-template-rush](https://github.com/PerfectPan/project-template-rush). Each bounded context is a
private package under `packages/`; `packages/agent-kit` is the published shell that re-exports their public names
and bundles them into `dist`. `infra/architecture/boundaries.ts` declares which package and layer may import what,
and a test checks the real import graph against it.

```bash
node common/scripts/install-run-rush.js install
npm run check   # format, build, lint, typecheck, test, package checks
```

- [`docs/plans/0001-agent-kit.md`](docs/plans/0001-agent-kit.md): design, decisions and phases.
- [`docs/specs/0001-agent-kit.md`](docs/specs/0001-agent-kit.md): behavior of the public entries.
- [`docs/architecture/authoring.md`](docs/architecture/authoring.md): how to write a context package.
- [`CONTEXT.md`](CONTEXT.md): glossary.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`docs/development/release.md`](docs/development/release.md): workflow and
  releases.

## License

MIT. See [LICENSE](LICENSE).
