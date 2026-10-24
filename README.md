# agent-kit

[![npm](https://img.shields.io/npm/v/@rivus/agent-kit)](https://www.npmjs.com/package/@rivus/agent-kit)
[![CI](https://github.com/PerfectPan/agent-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/PerfectPan/agent-kit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Read, measure and extend the coding agents installed on a machine — Claude Code, Codex, Grok, Gemini CLI, opencode, Pi
and Cursor — through one TypeScript API.

Every coding agent stores its sessions, token usage and hook payloads in its own format, under its own home directory.
agent-kit keeps that knowledge in one place, so a dashboard, a usage tracker or an orchestrator does not reimplement it
per agent:

- **Sessions and transcripts**: list an agent's sessions and read them into one ordered event model, with subagent
  lanes, compactions and pointers back to the original records.
- **Usage and cost**: scan token usage across agents incrementally, with one convention (OTel GenAI and the AI SDK),
  and price it with a table you provide.
- **Hooks and harness**: parse the payload any agent's hook receives, and install your hooks and skills into the
  agents with a ledger that removes exactly what was written.
- **Discovery and ACP**: detect which agents are installed and logged in, and drive an agent over the Agent Client
  Protocol.

Files, processes and the environment come from a `Platform` object the caller passes in, so every entry except
`/node`, `/node/effect` and `/testing` also bundles for browsers.

Status: 0.x. A minor release may contain breaking changes. This README follows `main`; the npm release can lag
behind it until the next release, see each package's `CHANGELOG.md`.

## Install

```bash
npm install @rivus/agent-kit
```

ESM only, no side effects, Node.js 22.13 or later. The Effect entries (`/acp`, `/harness`, `*/effect`) need `effect`
installed at exactly the version in `peerDependencies.effect` (`npm view @rivus/agent-kit peerDependencies.effect`);
the other entries do not load it.

## Quick start

List the sessions of three agents and read each one:

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

Hook events, harness installation, usage records, cost, Effect and ACP each have an example in the
[`@rivus/agent-kit` reference](packages/agent-kit/README.md).

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

Another agent plugs in as a provider descriptor (`providers: [{ id: "my-agent", sessions: adapter }]`) and is checked
with the conformance suites in `/testing`.

## Entries

| You want to                                         | Entry                                                   |
| --------------------------------------------------- | ------------------------------------------------------- |
| List sessions and read transcripts                  | `/sessions`, `/transcript`                              |
| Scan token usage; price it                          | `/transcript/usage`, `/cost`                            |
| Read a hook payload inside a hook process           | `/harness/events`                                       |
| Install and remove hooks and skills                 | `/harness` (Effect)                                     |
| Detect installed agents and their login state       | `/discovery`                                            |
| Drive an agent over ACP                             | `/acp` (Effect)                                         |
| Hide home paths and secrets before showing logs     | `/redact`                                               |
| Look up the built-in agents and their services      | `/providers`, `/catalog`                                |
| Provide files, processes and environment            | `/platform`, `/node`, `/platform/effect`, `/node/effect` |
| Test your own adapter, hook dialect or probe recipe | `/testing`, `/testing/effect`                           |

`/cost`, `/redact`, `/harness/events` and `/transcript/usage` import nothing outside the package, so a host that cannot
install dependencies can bundle them alone. Every entry is `@rivus/agent-kit/<entry>`; the
[reference](packages/agent-kit/README.md) lists their main exports, where each runs and how each fails.

## Packages

| Package                                                     | What it holds                                                                                 |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [`@rivus/agent-kit`](packages/agent-kit/README.md)          | The entries above                                                                             |
| [`@rivus/agent-kit-collab`](packages/agent-kit-collab/README.md) | Fenced leases (`/lease`), single-instance process locks (`/process-lock`) and keyed scheduling lanes (`/lanes`) for processes that run agents side by side |

Both packages release together at one version.

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
