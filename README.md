# agent-kit

[![npm](https://img.shields.io/npm/v/@rivus/agent-kit)](https://www.npmjs.com/package/@rivus/agent-kit)
[![CI](https://github.com/PerfectPan/agent-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/PerfectPan/agent-kit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**The Universal Agent Toolkit.** One TypeScript API to connect to any Agent — detect it, read its sessions and token
usage, follow its hooks, install into it, drive it over ACP — and to coordinate many Agents working side by side.

Think of it as lodash for cross-Agent tools: small typed functions, one entry per task, and the same call for every
Agent. Built-in providers cover Claude Code, Codex, Cursor and more; any other Agent plugs in as a provider of your own,
so your code does not change when a new Agent arrives.

| Package                                                          | Role                               | What it holds                                                                                |
| ---------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------- |
| [`@rivus/agent-kit`](packages/agent-kit/README.md)               | Connection: one Agent at a time    | Agent detection, sessions and transcripts, token usage and cost, hook events, harness installation, ACP, redaction |
| [`@rivus/agent-kit-collab`](packages/agent-kit-collab/README.md) | Coordination: many Agents at once  | Single-instance process locks, fenced leases, keyed scheduling lanes                         |

Both packages release together at one version. Status: 0.x; a minor release may contain breaking changes. This README
follows `main`, and the npm release can lag behind it until the next release; each package's `CHANGELOG.md` lists what
shipped.

## Install

```bash
npm install @rivus/agent-kit
npm install @rivus/agent-kit-collab   # coordination primitives, optional
```

ESM only, no side effects, Node.js 22.13 or later. Every entry except `/node`, `/node/effect` and `/testing` also
bundles for browsers: files, processes and the environment come from a `Platform` object the caller passes in. The
Effect entries (`/acp`, `/harness`, `*/effect`, and collab's `/lease` and `/lanes`) need `effect` installed at exactly
the version in `peerDependencies.effect` (`npm view @rivus/agent-kit peerDependencies.effect`); the other entries do not
load it.

## Quick start

### Connection

List the sessions of three Agents and read each one:

```ts
import { createNodePlatform } from "@rivus/agent-kit/node";
import { isSessionHead, listSessions } from "@rivus/agent-kit/sessions";
import { loadTranscript } from "@rivus/agent-kit/transcript";

const platform = createNodePlatform();

for await (const item of listSessions(platform, { agents: ["claude-code", "codex", "grok"] })) {
  if (!isSessionHead(item)) continue; // an unreadable file, with item.error
  const result = await loadTranscript(platform, item.ref);
  if (!result.ok) continue; // result.error._tag names the failure
  const { events } = result.value;
  const toolCalls = events.filter((event) => event.kind === "tool_call").length;
  console.log(item.ref.agent, item.title ?? item.ref.path, `${events.length} events, ${toolCalls} tool calls`);
}
```

The same call reads an Agent of your own once you pass its provider:

```ts
const myAgent = { id: "my-agent", sessions: mySessionAdapter };
listSessions(platform, { agents: ["my-agent"], providers: [myAgent] });
```

### Coordination

Keep one instance of a worker running:

```ts
import { createNodePlatform } from "@rivus/agent-kit/node";
import { acquireProcessLock } from "@rivus/agent-kit-collab/process-lock";

const lock = await acquireProcessLock(createNodePlatform(), "/var/run/my-daemon/daemon.lock");
if (!lock.ok) {
  console.error(`already running (pid ${lock.error.holder?.pid ?? "unknown"})`);
  process.exit(1);
}
// ... run; the kernel releases the lock if the process dies, or call:
await lock.value.release();
```

Hook events, harness installation, usage records, cost, Effect and ACP each have an example in the
[`@rivus/agent-kit` reference](packages/agent-kit/README.md); leases and lanes are in the
[`@rivus/agent-kit-collab` reference](packages/agent-kit-collab/README.md).

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

These are today's built-in providers. Any other Agent plugs in as a provider descriptor
(`providers: [{ id: "my-agent", sessions: adapter }]`) and is checked with the conformance suites in `/testing`.

## Entries

| You want to                                         | Entry                                                    |
| --------------------------------------------------- | -------------------------------------------------------- |
| Detect installed Agents and their login state       | `/discovery`                                             |
| List sessions and read transcripts                  | `/sessions`, `/transcript`                               |
| Scan token usage; price it                          | `/transcript/usage`, `/cost`                             |
| Read a hook payload inside a hook process           | `/harness/events`                                        |
| Install and remove hooks and skills                 | `/harness` (Effect)                                      |
| Drive an Agent over ACP                             | `/acp` (Effect)                                          |
| Hide home paths and secrets before showing logs     | `/redact`                                                |
| Look up the built-in Agents and their services      | `/providers`, `/catalog`                                 |
| Provide files, processes and environment            | `/platform`, `/node`, `/platform/effect`, `/node/effect` |
| Test your own adapter, hook dialect or probe recipe | `/testing`, `/testing/effect`                            |
| Keep one instance of a worker running               | collab `/process-lock`                                   |
| Give one worker a task, with a fencing token        | collab `/lease` (Effect)                                 |
| Run one turn per key under a concurrency cap        | collab `/lanes` (Effect)                                 |

Entries are `@rivus/agent-kit/<entry>`, and `@rivus/agent-kit-collab/<entry>` for collab. `/cost`, `/redact`,
`/harness/events` and `/transcript/usage` import nothing outside the package, so a host that cannot install dependencies
can bundle them alone. The package references list each entry's main exports, where it runs and how it fails.

## Built with agent-kit

- [agent-presence](https://github.com/PerfectPan/agent-presence): the Agents running on a machine, and their token
  usage, in a Feishu signature preview.
- [agent-task-loop](https://github.com/PerfectPan/agent-task-loop): Agents taken through task execution, review,
  rework and pull-request handoff.

## Development

A pnpm workspace. Each bounded context is a private package under `packages/`; `packages/agent-kit` re-exports their
public names and bundles them into `dist`, and `infra/architecture/boundaries.ts` declares which package and layer may
import what.

```bash
pnpm install
pnpm run check   # format, build, lint, typecheck, test, package checks
```

- [`CONTRIBUTING.md`](CONTRIBUTING.md): workflow, Spec and Plan rules, required checks.
- [`docs/architecture/authoring.md`](docs/architecture/authoring.md): how a context package is laid out.
- [`docs/development/adoption.md`](docs/development/adoption.md): migrating an application, verification and rollback.
- [`docs/development/release.md`](docs/development/release.md): releases.
- [`CONTEXT.md`](CONTEXT.md): glossary.

## License

MIT. See [LICENSE](LICENSE).
