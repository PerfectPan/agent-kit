# agent-kit

Shared building blocks for applications that work with third-party coding agents such as Claude Code, Codex and
Grok. `@rivus/agent-kit` knows who each agent is and where it keeps its data, reads its session logs into one
transcript and usage model, and takes files, processes and the environment through an injected `Platform` port, so
the same code runs in Node and, for most entries, in a browser.

Status: **pre-release**. Nothing is on npm yet; the first release is `0.1.0`.

## Entries in 0.1.0

| Entry | Contents | Runs in |
| --- | --- | --- |
| `@rivus/agent-kit/catalog` | `CodingAgentId`, `AgentHome`, built-in agent identities, `resolveHome`, `Result` | anywhere |
| `@rivus/agent-kit/platform` | `Platform` port types, `ProcessIdentity`, the byte-stream line splitter | anywhere |
| `@rivus/agent-kit/node` | `createNodePlatform()` | Node |
| `@rivus/agent-kit/sessions` | `listSessions` for Claude Code, Codex and Grok | anywhere, with a `Platform` |
| `@rivus/agent-kit/transcript` | per-agent translation, `streamEvents`, `loadTranscript` | anywhere, with a `Platform` |
| `@rivus/agent-kit/testing` | `createMemoryPlatform()` and conformance tests | Node |

`/platform` has its content; the other entries export placeholders until their contexts land. Discovery, cost, harness
(injection and hook events), ACP and redaction come in later releases, as does `@rivus/agent-kit-collab` (leases,
process locks, lanes). The package is ESM-only, has no side effects, and requires Node.js 22.13 or later.

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

- [`docs/plans/0001-agent-kit.md`](docs/plans/0001-agent-kit.md): design and phases.
- [`docs/specs/0001-agent-kit.md`](docs/specs/0001-agent-kit.md): behavior of the public entries.
- [`docs/architecture/authoring.md`](docs/architecture/authoring.md): how to write a context package.
- [`CONTEXT.md`](CONTEXT.md): glossary.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`docs/development/release.md`](docs/development/release.md): workflow and
  releases.

## License

MIT. See [LICENSE](LICENSE).
