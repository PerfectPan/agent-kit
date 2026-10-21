# Provider packages, a service directory and a pnpm workspace

This plan restructures agent-kit in four connected steps. Each coding agent's adapter code moves into one provider package. The contexts route every call through one service directory. The domain model is reclassified along DDD lines. The repository moves from Rush to a pnpm workspace. It also narrows the public surface to names that have a consumer, and replaces the hand-written boundary checker with lint rules. Compatibility is not kept: the result ships as 0.20.0, and the consuming applications update when they upgrade.

- Status: in review
- Owner: PerfectPan
- Reviewer: unconfirmed
- Last updated: 2026-10-20
- Paired Spec: none (a technical refactor; the public API changes are listed in [3.10](#310-compatibility-and-migration))

## Contents

- [1. Background and goals](#1-background-and-goals)
- [2. Outline](#2-outline)
- [3. Detailed design](#3-detailed-design)
- [4. Release and rollback](#4-release-and-rollback)
- [5. Verification](#5-verification)
- [6. Execution plan](#6-execution-plan)
- [7. Risks and open questions](#7-risks-and-open-questions)
- [Appendix](#appendix)

As in [plan 0001](0001-agent-kit.md), consumers that are not public are named by role. "The trace viewer" is the private browser viewer for agent sessions. "The host application" is the private Effect-based host application that runs agents. Counts and file references are from `main` at 821ebcf.

## 1. Background and goals

### 1.1 Current behavior and constraints

**Agent adapter code is split by concept.** Seven built-in agents are supported. Their code lives in the `adapters/` folders of five context packages, and seven built-in tables register it:

- `builtinCodingAgents`
- `builtinProbeRecipes`
- `builtinInstallAdapters`
- `builtinHookDialects`
- `builtinSessionAdapters`
- `builtinUsageDecoders`
- `builtinAcpProfiles`

| Agent | Identity | Discovery | Hooks | Install | Sessions | Usage | ACP | Files | Lines |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --: | --: |
| codex | ● | ● | ● | ● | ● | ● | ● | 17 | 2,474 |
| claude-code | ● | ● | ● | ● | ● | ● | ● | 17 | 2,273 |
| grok | ● | ● | ● | ● | ● | ● | ● | 15 | 1,962 |
| opencode | ● | ● | ● | ● | – | ● | ● | 10 | 980 |
| gemini-cli | ● | ● | ● | ● | – | ● | ● | 9 | 514 |
| pi | ● | ● | ● | ● | – | ● | – | 8 | 404 |
| cursor | ● | ● | ● | ● | – | – | – | 5 | 277 |

"Sessions" means session listing and transcripts (`SessionAdapter`). The counts cover the agent-named files under `domain/*/adapters/` and under sessions' `application/services/{session-adapters,usage-decoders}/`, without tests. Helpers shared by several agents add about 960 lines.

**The coupling runs by agent.** One agent's files import each other across concepts. Claude Code's `transcript/adapters/claude-code/events.ts` imports `usage/adapters/claude-code` and `session/adapters/claude-code/layout`, and the usage file imports the transcript's `record.ts`. Codex and Grok do the same. No file of one agent imports a file of another agent.

**Agent facts are duplicated or leak out of the adapter folders:**

- Claude Code's session directory `<home>/projects` is written in both `sessions/src/domain/session/adapters/claude-code/layout.ts:14` and `discovery/src/domain/installation/adapters/claude-code.ts:59`.
- `BuiltinCodingAgentId` and `CodingAgentIdWithHome` in catalog spell out the ids.
- `harness/src/domain/lifecycle/policies/host-sniffing.ts` names cursor and grok and reads `CURSOR_VERSION`.
- sessions' `public.ts` exports per-agent names such as `translateCodexRecords` and `CLAUDE_CODE_CAPABILITIES`.

**Routing is written in many places.** Finding the adapter of an agent, and deciding what happens when there is none, happens in:

- eleven use cases or services: sessions' `listSessions`, `loadTranscript`, `decodeUsage`, `listUsageSources`, `scanUsage`; discovery's `detectAgents`; harness's `planInstall`, `findLegacy`, `readHookEvent` and hook placement; acp's `connectAgent`;
- four catalog functions: `parseCodingAgentId` (aliases), `homeRuleOf`, `resolveHome`, `isBuiltinCodingAgentId`, which read `builtinCodingAgents` (`catalog/src/domain/coding-agent/adapters/index.ts:40-80`);
- two published conformance suites, which read built-in tables at run time (`testing/src/hook-dialect-conformance.ts:115`, `probe-recipe-conformance.ts:235`).

A caller's override has four meanings:

- replace the table: `listSessions`, `loadTranscript`, `detectAgents`;
- merge over it: `planInstall`, `findLegacy`, `readHookEvent`;
- replace one agent's entry: `connectAgent`;
- no override at all: `decodeUsage`, `listUsageSources`, `scanUsage`.

`CapabilityUnsupported` lives in sessions, and each context has its own error helper.

**`value-objects/` holds four kinds of things.** It has 63 files, and 29 of them declare only types:

| Kind | Examples |
| --- | --- |
| Value objects | `ContentHash`, `Version`, `LeaseTiming`, `CalendarWindow`, `ArtifactLocator` |
| Read-side data handed to applications | `TranscriptEvent`, `UsageRecord`, `SessionSummary` |
| Aggregate snapshots | `AcpSessionSnapshot`, `LeaseSnapshot`, `LaneSnapshot` |
| Adapter contracts | `InstallAdapter`, `HookDialect`, `ProbeRecipe` |

**`policies/` mixes three kinds of code:**

- rules about one type, which belong to that type;
- rules across several objects, which are domain services;
- utilities.

Its line with `services/` is not checkable: `threeWayVerify` sits in `policies/`, while the comparable `placeHooks` sits in `services/`.

**The public surface is wide.**

- The shell's 17 entries export 456 distinct names. The three consuming applications use 107 of them, not counting `@rivus/agent-kit-collab`.
- Besides the entries `authoring.md` defines, each package has a sibling `index.ts`, and 14 concept folders have an `index.ts` that only re-exports.

**The boundary checker is hand-written.** `infra/architecture/` holds about 1,000 lines:

- `check-boundaries.ts`: 346 lines, 15 rule ids, parses imports with oxc-parser;
- `boundaries.ts`: 169 lines, the manifest of packages, layers and allowed dependencies;
- `workspace.ts`: 38 lines, reads the project list from `rush.json`;
- `boundaries.test.ts`: 458 lines.

**The build and release depend on Rush:**

- `rush.json` and `common/`;
- every root script, which goes through `install-run-rush`;
- three of the four workflows (`ci.yml`, `version-packages.yml`, `publish-npm.yml`) and the release scripts (`release-state.ts`, `release-notes.ts`, `release-intent.ts`, `check-release.ts`);
- the documentation.

The automatic release flow depends on `release-state.ts`. It prints `version`, `publish` or `none` for each push to `main`. `version-packages.yml` uses it to decide whether to open the Version Packages PR, and `publish-npm.yml` uses it to decide whether to publish, to tag the commit and to create the GitHub Release.

Dependabot cannot update Rush's lockfile, and its pull request #139 is stuck on `rush install`. The maintainer decided to move every TypeScript repository from Rush to a pnpm workspace; the target layout is the public template `PerfectPan/project-template-pnpm`. The trace viewer has already migrated.

### 1.2 Problem

**Adding or fixing one agent touches five packages.** A Claude Code storage change has to be made in both sessions and discovery. Nothing stops agent knowledge from spreading further: the boundary test checks imports, not agent facts.

**Every context re-implements routing**, with different override semantics and errors.

**The model folders do not say what their contents are.** Aggregate snapshots and adapter contracts sit among value objects, and single-type rules sit apart from their types.

**Most exported names have no consumer.** Each one is still an API that cannot change without a breaking release.

**Rush blocks routine maintenance.** Dependabot cannot run, and two release scripts duplicate what pnpm and `changesets/action` provide.

### 1.3 Goals and success criteria

1. Each built-in agent's adapter code and facts live in one package, `packages/providers/<agent>`. Outside it, the only per-agent code is one import per service in the shell's service tables.
2. No context source file (outside tests) contains a built-in agent id or another agent marker string; a lint rule fails when one does.
3. Every capability lookup goes through catalog's lookup functions. A caller's override has one meaning: provider descriptors merged by agent id, service by service.
4. The model follows [3.7](#37-context-layout-and-the-domain-model):
   - write-side value objects and entities are classes;
   - read-side value objects are plain data;
   - no `policies/` folder remains;
   - no adapter contract sits in `value-objects/`.
5. Each shell export has a consumer: an application, a third-party provider, or the testing entry. Each package keeps only the entry files of [3.8](#38-public-surface).
6. The boundary rules run as lint rules in `vp lint`, plus a small manifest test for the rules about `package.json`. Each rule has a fixture that violates it and one that does not.
7. The repository is a pnpm workspace:
   - `rush.json` and `common/` are gone;
   - Dependabot runs;
   - releases go through `.changeset/*.md`, `pnpm version -r` and `changesets/action`;
   - 0.19.1 has been published through that path.
8. 0.20.0 is published, and agent-presence, agent-task-loop and the trace viewer each have an upgrade PR.

### 1.4 Non-goals

- Publishing provider packages separately. They stay private and bundled. Their package boundary makes publishing them later a packaging change only.
- Moving the read-side contexts to Effect. This waits for live following or background index refresh, as plan 0001 3.7 states.
- Adopting the kit in the host application, and migrating the other Rush repositories.
- Changing what any use case does, beyond the API changes listed in [3.10](#310-compatibility-and-migration).

## 2. Outline

### 2.1 Design principles

- **Code that changes for the same upstream reason lives together.** An agent's upstream changes are per agent: a hook rename, a storage move, a new CLI flag. Provider packages follow that unit. Formats shared by several agents belong to no single provider.
- **The dependency direction is fixed.** The shell depends on providers and contexts, and providers depend on contexts' `spi.ts`. Contexts never depend on providers, and providers never depend on each other.
- **No compatibility layer.** Names and semantics change once, in 0.20.0.
- **Mature tools before hand-written code**: lint plugins for the boundary rules, `pathe` for paths, and pnpm and `changesets/action` for releases.

### 2.2 Boundaries and responsibilities

```text
application (agent-presence, agent-task-loop, the trace viewer, ...)
   │ calls listSessions(), planInstall(), ...
   ▼
kit contexts (catalog, discovery, sessions, harness, acp, cost): models and use cases
   │ looks up the service tables: which provider serves this agent?
   ▼
provider packages (one per agent): implement the SPI
```

| Term | Meaning |
| --- | --- |
| Context | One of catalog, discovery, sessions, harness, acp, cost. It owns a model and its use cases. |
| Application interface | A context's `public.ts`, published through the shell. |
| SPI | The interfaces a context requires providers to implement, plus the helpers for writing a provider. The entry file is `spi.ts`. |
| Service | One of seven capabilities: identity, discovery, hooks, install, sessions, usage, ACP. Each has one SPI interface. |
| Provider package | One per agent. It implements the services that agent supports. |
| Provider descriptor | A `Provider` value: an agent id plus the service implementations it supplies. |
| Service table | One per service, keyed by agent id (`ServiceTable<T>`). The shell builds the built-in tables from the providers. |

A context can provide several services:

- sessions provides sessions and usage, because usage decoding shares each agent's rules with its transcript translation;
- harness provides hooks and install, because both use the HookDialect.

The context is the unit of model ownership, and the service is the unit of capability and routing.

### 2.3 Main path

The application calls a shell entry, for example `listSessions(platform, { providers })`. The shell function merges the caller's provider descriptors over the built-in ones and passes the context the service tables it needs. The context's use case asks catalog's lookup for each agent's provider. A missing provider becomes `CapabilityUnsupported` in the data, or an `AgentKitError` when the caller named that agent. The provider reads the agent's files through the injected Platform and translates them into the context's model.

### 2.4 Design decisions

| Decision | Chosen | Alternatives and why not |
| --- | --- | --- |
| Where adapter code lives | One package per agent, `packages/providers/<agent>`, named `@rivus/agent-kit-provider-<agent>` | Per-concept `adapters/` folders (today): one agent's code spreads over five packages. One `agents` package with a folder per agent: package boundaries enforce what folders cannot. |
| Publishing providers | Private, bundled into the shell | Separate npm packages: every current consumer uses every agent, and seven more release units cost more than they return. |
| Routing | Static service tables assembled in the shell, plus lookup functions in catalog | A global registry or runtime registration: `authoring.md` forbids a global registry, and several installed copies of the kit would each hold their own state. |
| Defaults | Context use cases require their service tables; about a dozen shell functions bind the built-in providers | Contexts importing the providers: a cycle. Splitting each context into a "model + SPI" package and a "use cases" package: twice the packages for the same result. |
| Override shape | One option on every routed shell function: `providers?: readonly Provider[]` | One table per service in each option (`adapters`, `dialects`, ...): `planInstall` and `findLegacy` already take two, and every use case would differ. A descriptor is also what a third-party provider naturally is. |
| SPI interface names | Keep the domain names (`HookDialect`, `SessionAdapter`, `ProbeRecipe`, `InstallAdapter`, `UsageDecoder`, `AcpProfile`, `CodingAgent`) | Renaming to `XxxProvider`: the names say what each interface is; "provider" names the package that bundles them. |
| Write-side model | Classes, crossing the boundary as snapshots (`toSnapshot()` / `restore()`); a DTO only where a public shape must differ from the snapshot | Plain data with rules in `policies/` (today): behavior sits away from its type. A DTO layer everywhere: mapping code with no consumer. |
| Read-side model | Plain-data value objects; behavior in domain services | Classes: every event would need a DTO before reaching the application. "Read models": the read-only contexts have no write model; this data is their domain model. |
| `policies/` | Removed: single-type rules become methods, cross-object rules become domain services, utilities move to `lib/` | Keeping it: it does not match DDD's Policy (a replaceable strategy). In this kit the per-agent tables are the strategies. |
| Boundary checker | Lint rules in `vp lint` (eslint-plugin-boundaries through oxlint's JS plugins, plus built-in rules) and a small manifest test ([3.9](#39-boundary-rules)) | ast-grep plus dependency-cruiser: two more tools, and the agent marker list would live in YAML. Keeping the checker: about 1,000 lines of custom code. The fallback, if the lint spike fails, is ast-grep plus dependency-cruiser. |
| Workspace and release | pnpm workspace; `.changeset/*.md`, `pnpm version -r`, `changesets/action@v2`; layout from `PerfectPan/project-template-pnpm` | Rush: no maintained release-PR action, Dependabot cannot run, and the maintainer decided to leave it. |
| Release trigger | Automatic, as today: a push to `main` with change records opens or updates the Version Packages PR, and merging it publishes. `release-state.ts` is kept and ported | The template's manual dispatch with a GitHub Release trigger. The automatic flow was chosen on 2026-10-07 and matches how `changesets/action` works. The template has no equivalent of `release-state.ts`. |

## 3. Detailed design

### 3.1 Repository layout and dependency rules

```text
pnpm-workspace.yaml        members: packages/*, packages/providers/*, infra/*, tests/*, scripts
packages/
  agent-kit/               the shell: the only published entry point of @rivus/agent-kit
  providers/<agent>/       one private package per built-in agent
  catalog/                 CodingAgentId, CodingAgent, AgentHome, home rules, Result, ServiceTable, lookups
  discovery/  sessions/  harness/  acp/  cost/
  platform/  platform-node/  redact/  testing/
  agent-kit-collab/        published in lockstep with @rivus/agent-kit
infra/architecture/        the boundary lint configuration, the manifest test and their fixtures
tests/smoke/  scripts/
```

Dependency rules (enforced by [3.9](#39-boundary-rules)):

- The shell may depend on providers and contexts.
- A provider may depend on catalog's `spi` entry, platform (port types only), each other context's `spi` entry and `zod/mini`.
  `spiImports` grants only the SPI entry; `dependsOn` independently grants the normal index.
- A context may not depend on any provider.
- A provider may not depend on another provider.
- testing's sources may not depend on providers. testing's and the contexts' tests may use providers through `testsOnly`.

### 3.2 Provider packages

```text
packages/providers/claude-code/
  package.json        "name": "@rivus/agent-kit-provider-claude-code", "private": true;
                      one "exports" subpath per service file below
  src/
    facts.ts          the agent's facts, written once: home rule, credential and configuration files,
                      environment variables, command names, and its marker strings for the lint rule
    layout.ts         where the agent stores sessions and usage; read by discovery, sessions and usage
    records.ts        parsing of the agent's log records and other code shared by sessions and usage (agents with logs)
    identity.ts       CodingAgent                                   → ./identity
    discovery.ts      ProbeRecipe                                   → ./discovery
    hooks.ts          HookDialect                                   → ./hooks
    install.ts        InstallAdapter                                → ./install
    usage.ts          UsageDecoder and per-line usage decoding      → ./usage
    sessions/         SessionAdapter: listing, preview, transcript  → ./sessions
    acp.ts            AcpProfile                                    → ./acp
  test/               the agent's tests and fixtures; runs each service's conformance suite
```

- A provider creates only the files of the services it supports. The shell records why a service is unsupported.
- There is no barrel file. The shell imports each service from its own subpath, so an entry bundles only the services it binds.
- Import limits inside a provider:
  - `hooks.ts` imports only `facts.ts`, catalog's SPI (the zero-dependency shared kernel), harness's SPI and `zod/mini`;
  - `usage.ts` imports only `facts.ts`, `layout.ts`, `records.ts`, catalog's SPI, sessions' SPI and `zod/mini`, never `sessions/`;
  - code that both sessions and usage need lives in `records.ts` (or a `records/` folder), never in `sessions/`. For example, Codex's fork replay (`transcript/adapters/codex/fork-replay.ts` today), which its usage decoding also uses, moves to `records/`.
  - these limits also apply to every allowed local helper, including nested `records/` files; `facts.ts`, shared by both entries, satisfies both limits.

  The hook entry `/harness/events` binds only `./hooks`. The zero-dependency entry `/transcript/usage` binds only `./usage`; it keeps `decodeUsage`, `listUsageSources` and `scanUsage`, which read files through the injected Platform. Both entries keep importing nothing at run time: `zod/mini` stays bundled into them, as `ZOD_BUNDLE_ENTRIES` in `packages/agent-kit/scripts/check-dist.ts` requires today.
- Relations between agents are declared by agent id, not by import. Grok and Cursor also run Claude Code's hooks; they declare that in their own HookDialect, as `foreignHooks` does today.
- Formats shared by several agents belong to no provider. They are SPI helpers of the context that reads them, named by format:
  - the ACP `session/update` translation (sessions);
  - the Claude-style hook configuration that Codex, Gemini CLI and Grok copy (`commandHook`, `groupedHooksFile`, harness);
  - the `~/.agents/skills` directory that every agent except Claude Code reads (harness);
  - the base ACP environment (acp).

### 3.3 Service tables, descriptors and routing

- **catalog** gains:
  - `ServiceTable<T>`: a read-only partial record from agent id to `T`;
  - two lookups: one returns `Result<T, CapabilityUnsupported>`, for data that names an agent without a provider; the other throws `AgentKitError` with code `capability-unsupported`, for options in which the caller named such an agent;
  - `CapabilityUnsupported`, moved from sessions.

  The lookup names are `lookupService(agent, table)` and `requireService(agent, table, reason?)`. Only own,
  non-null entries count; inherited properties, `null` and `undefined` are missing. The throwing lookup accepts a
  reason so each use case can keep a service-specific message. The lookups, `ServiceTable`, and `homeRuleOf` are
  sibling-context exports, not new shell exports. Identity table queries accept third-party ids too.
  Part A introduces these foundations and passes the current built-in identity table at existing callers; Part B
  switches the routing sites and shell bindings.

  Every routing site in 1.1 uses them.
- **The `Provider` descriptor** is declared in the shell, because it names the SPI types of every context:

  ```ts
  interface Provider {
    readonly id: CodingAgentId;
    readonly identity?: CodingAgent;
    readonly discovery?: ProbeRecipe;
    readonly hooks?: HookDialect;
    readonly install?: InstallAdapter;
    readonly sessions?: SessionAdapter;
    readonly usage?: UsageDecoder;
    readonly acp?: AcpProfile;
  }
  ```

  Provider packages do not import it, because they may not depend on the shell. The shell checks their parts with `satisfies` where it assembles them.
- **Context use cases** take a required `providers` option. It holds exactly the service tables they read; for example, `planInstall` takes `{ install, hooks }`, `readHookEvent` takes `{ hooks }` and `listSessions` takes `{ sessions, identity }`. A use case takes `identity` when it resolves homes or aliases.
- **Shell functions** take `providers?: readonly Provider[]`. The descriptors are merged over the built-in ones by agent id, service by service: a descriptor that sets only `hooks` for an id replaces only that id's hooks. The shell then builds the tables and calls the context.

  ```ts
  // packages/agent-kit/src/sessions.ts (illustrative)
  export const listSessions = (platform: SessionPlatform, options: ShellListSessionsOptions = {}) =>
    sessions.listSessions(platform, { ...options, providers: tablesFor(["sessions", "identity"], options.providers) })
  ```

  This ends the rule that shell entries only re-export names; `authoring.md` changes with it. Local shell imports
  are declared per file in `boundaries.shellImports`, so the hooks entry cannot import the complete descriptor list.
  `/providers` exports `Provider` and `builtinProviders`. Related public operations (`verify`, `uninstall`, `doctor`,
  `probeAgent`, `summarizeSession`, `sessionAdapterHome`) bind the same tables as the use cases they call. Existing
  individual built-in table exports remain until provider closeout; the old override options do not.
  Descriptor types use the narrow `acp/public/profiles` and `harness/public/install` type entries: importing their
  aggregate public entries makes declaration bundling carry Effect into the plain and zero-dependency entries.
- **The built-in tables** are built in `packages/agent-kit/src/providers/<service>.ts`, one module per service, each importing that service's subpath from every provider. `builtinProviders` (all descriptors) is assembled in its own module.
- **Unsupported services**: `packages/agent-kit/src/providers/unsupported.ts` records, for each built-in agent and service it does not provide, the reason.
- **The capability check** requires each built-in agent to either provide each service or have a recorded reason. The README support matrix is written in the same batch, and a test keeps it equal to the tables.

### 3.4 Identity and homes

- catalog keeps the identity model (`CodingAgent`, `HomeRule`, `homeFromRule`, `CODING_AGENT_ID_PATTERN`) but no longer owns the identity table.
- The functions that read the table take it as a parameter:
  - `parseCodingAgentId(input, identities)` resolves aliases from the given table;
  - `homeRuleOf(agent, identities, own?)` keeps today's precedence: the caller's own rule, then the table's.
- Identity tables reject keys differing from `identity.id` and names shared by different identities. Canonical ids
  are registered before aliases; the shell validates its merged identity table with `validateIdentities`, also used
  by catalog parsing.
- `resolveHome` and `CodingAgentIdWithHome` are removed. They have no consumer outside the kit, and `homeFromRule` with the table's rule does the same. Inside the kit, harness's install adapters call `resolveHome` in five places (`harness/src/domain/bundle/adapters/*/config-files.ts`); they take the home from their provider's facts instead.
- `BuiltinCodingAgentId` and `isBuiltinCodingAgentId` leave the catalog package in batch 12, together with the identity table. Until then the contexts' built-in tables are still typed with the union, and a context may not depend on the shell, so catalog keeps it. From batch 12 the shell derives both from its provider list and still exports them from `/catalog`. The shell also exports `sessionAdapterHome(adapter, context)` bound to the built-in identities, because the trace viewer uses it for its own adapter. A bound one-argument `parseCodingAgentId` is exported only if batch 13 finds a consumer for it.
- A provider's service objects that need a home carry the home rule from its `facts.ts`. Contexts fall back to the identity table only for adapters that bring no rule, which keeps a third-party adapter for a built-in agent working as it does today.

### 3.5 Host markers

`sniffSource` decides which agent really runs a hook.

- Today it checks payload fields in a fixed order: `hookEventName` means grok, then `cursor_version` means cursor.
- After that it checks the environment variable `CURSOR_VERSION`, which counts only when the declared agent is one whose hooks cursor runs (`host-sniffing.ts:18-36`).

The rule becomes data that each provider declares in its HookDialect:

```ts
interface HostMarkers {
  /** A payload that carries one of these top-level fields was sent by this agent. */
  readonly payloadFields?: readonly string[];
  /** One of these environment variables marks this agent, but only when the declared agent is one whose hooks this agent also runs. */
  readonly env?: readonly string[];
}
```

- Precedence: every payload marker before any environment marker.
- Within each kind, providers are checked in the order of the hooks table. The shell lists grok before cursor, which keeps today's order.
- `terminalIdentity` (recognizing the terminal multiplexer) is not agent knowledge and stays in harness's lifecycle services.
- The existing host-sniffing tests must pass unchanged.

### 3.6 SPI entries

- Each context's `spi.ts` exports its SPI interfaces and the helpers providers need. For sessions this is about 120 symbols today:
  - the transcript model and event factories;
  - the session model;
  - the usage ports;
  - the ACP update translation;
  - the file helpers `walkFiles`, `readJsonlRecords`, `readBytes`, `readEdges`, `catchIoFailure`, `discoverSessions`, `decodeJsonlUsage`;
  - the `turns`, `request-placement` and `fold-transcript` rules.

  The list is reviewed name by name when the entry is created.
- Each context declares its `./spi` export with `spi: true` in the boundary manifest. An importer must list the
  target under `spiImports`; this grants no normal entry access. `dependsOn` independently grants the normal entry,
  never the SPI. This follows
  3.1's provider-to-context direction. No current context needs a sibling's SPI, so their `spiImports` remain empty;
  a future context use must be declared explicitly and still obey the layer and `typesOnly` restrictions. Provider-like
  lint fixtures exercise explicit access without registering a production provider before its batch.
- The sessions entry is derived from non-test adapter imports, including shared file and format helpers. It exports
  the SPI interfaces and their parts, then only imported context symbols; agent-specific layouts, records, tables
  and translators stay out. ACP format helpers are retained where Grok imports them. Catalog exports identity model types, `homeFromRule`, `ok`, `err`, `Result` and `AgentKitError`; built-in
  tables and their id union stay out of SPI. Cost has no provider consumer and therefore no SPI entry.
- SPI interface types are public through their service's shell entry, because the trace viewer implements its own `SessionAdapter` and runs `sessionAdapterConformance`. SPI helpers stay internal until a third-party provider needs one.
- Pure SPI interfaces (`HookDialect`, `InstallAdapter`, `ProbeRecipe`, `AcpProfile`) live in `domain/<concept>/spi/`. Interfaces that read files (`SessionAdapter`, `UsageDecoder`) live in `application/spi.ts`. `application/ports.ts` keeps only ports that the kit's own `infra/` implements.
- The published conformance suites take the service tables they need as parameters instead of reading built-in tables. For example, `hookDialectConformance` merges the dialect under test over a given hooks table so that host sniffing works as in use. The shell's `/testing` binds the built-in tables.

### 3.7 Context layout and the domain model

```text
<context>/src/
  domain/<concept>/
    aggregates/       aggregate roots (classes) with their snapshot types
    entities/         entities inside an aggregate (classes), created and changed only by the root's transitions
    value-objects/    write side: classes; read side: plain data
    services/         domain services: pure functions across several objects
    spi/              pure SPI interfaces
    factories/  errors/  events/
  application/
    use-cases/  services/
    ports.ts          ports implemented by the kit's infra
    spi.ts            SPI interfaces that read files
  infra/              unchanged; infra/adapters/ holds port implementations only
  lib/                pure functions with no domain meaning and no Node capability
  public.ts           application interface
  spi.ts              entry for providers
```

A Platform slice named by an SPI interface lives in `application/spi.ts` (sessions); a slice needed only by
use cases lives in `application/platform.ts` (discovery and acp). `ports.ts` holds only infrastructure ports.

The domain folders no longer have `adapters/`, so the name no longer clashes with `infra/adapters/`.

| Side | Scope | Value objects | Across the boundary |
| --- | --- | --- | --- |
| Write | harness bundle, install-plan, ledger; acp; collab lease and lanes | Classes that validate on construction and carry their rules | Snapshots, through `toSnapshot()` / `restore()` |
| Read | sessions, discovery, cost, catalog; harness lifecycle | Plain data; behavior in `services/` | The data itself |

- **Aggregates are unchanged.** InstallPlan, Ledger, AcpSession, Lease and Lane keep their shape.
- **Entities.** Only the Ledger has entities: `LedgerEntry`, `PendingOperation`, `KeptArtifact`. They become classes, for example `entry.heldBy(owner)` and `pending.resolve(actualHash)`, absorbing `ownership.ts` and `reconcile.ts`. No other aggregate tracks children by identity: AcpSession counts turns and pending permissions, Lane keeps a state and a pending flag, and InstallPlan steps never change after creation.
- **Sessions are value objects.** A session has an identity in the agent, but the kit reads moments of it and does not track its changes. `SessionRef` is an identifier, and `SessionHead` and `SessionSummary` are descriptions of a moment. This changes when the kit keeps its own session index.
- **Where today's `policies/` and `services/` functions go** is listed in [Appendix B](#b-destinations-of-policies-and-services). The write-side value objects that become classes, by batch:
  - install-plan: the 10 files under `install-plan/value-objects/` (`ArtifactLocator`, `PlanStep`, `Precondition`, `Conflict`, ...);
  - bundle: `Bundle`, `ArtifactSpec`, `Owner`, `RegistrationState`, `Strategy`;
  - acp: `McpServer`, `PromptBlock`, `SessionBinding`, and the new `AbsolutePath`;
  - collab: `FencingToken`, `Holder`, `LeaseTiming`, `LaneLimits`.

  Each batch confirms its list file by file. A type moves to another folder when it turns out to be a snapshot or an SPI interface.
- **`lib/`** holds only pure functions:
  - `lenient` (three copies today);
  - `timeOf`, `logTimestamp`, `timeOfValue`;
  - `ownValue`, `rememberKey`, `jsonText`;
  - `shortHash`, a hand-written cyrb53 hash kept because no small library fits; its comment says so.

  Code that needs a Node capability is not `lib/`. It takes the capability through the Platform port (a `Pick<Platform, ...>` first parameter in plain contexts, `PlatformService` in Effect contexts) and lives in `application/services/` or `infra/`. A missing capability is added to Platform and implemented by platform-node and the memory platform, as `fs.mkdir` was.
- **Paths.** `joinPath`, `basenamePath` and `dirnamePath` exist only because the domain cannot import `node:path`. They are replaced by `pathe` 2.0.3 (pure, no dependencies); `belowRoot` becomes `pathe`'s `relative` plus a prefix check.

### 3.8 Public surface

- A shell export needs a consumer: an application, a third-party provider (SPI interface types), or the testing entry. Option and result types that only appear in signatures are not exported by name; callers derive them with `Parameters` and `ReturnType`, as `authoring.md` already says.
- The pruning starts from the 456 names and the 107 that the applications use (Appendix A), and keeps the SPI interfaces and the testing suites.
- Entry files that stay:
  - each internal package (the contexts, platform, platform-node, redact, testing): `public.ts`, and `spi.ts` for the contexts;
  - the runtime-profile entries `authoring.md` allows: harness's `src/events.ts` (the hook path) and the `src/effect.ts` files of platform, platform-node and testing;
  - collab: one `src/<entry>/public.ts` per public entry;
  - providers: one file per service subpath (3.2);
  - the shell's entry files.

  Each package's sibling `index.ts` and the 14 concept `index.ts` files are removed. Siblings use `public.ts` or `spi.ts`, and files inside a package import the defining file directly.

### 3.9 Boundary rules

`vp lint` runs oxlint, which loads ESLint plugins through `jsPlugins` (alpha since 2026-03, outside semver). `infra/architecture/boundaries.ts` stays the one manifest: `infra/architecture/lint.ts` generates the lint configuration from it, and the manifest test reads the same allowed-dependency matrix. Generated messages carry the rule id in brackets, such as `[layer]`; the built-in Node rule and parser keep their own diagnostics.

| Rule | What it checks | Implementation |
| --- | --- | --- |
| `layer`, `deep-import`, `relative-escape`, `public-entry`, `external-dependency`, `types-only`, `package-dependency` (imports) | Imports between layers and packages, entry use, external packages, type-only upstream imports | eslint-plugin-boundaries `dependencies` policies, resolved by `eslint-import-resolver-typescript`: element types by path (each context layer, the shell), workspace packages judged by specifier, relative imports by the element they resolve to, `dependency.kind` for type-only imports. A relative import that resolves to no file reports `[unresolved]`. The new provider rules of 3.1 are written the same way |
| `node-builtin` | `node:*` only in platform-node | oxlint's built-in `import/no-nodejs-modules`, off for platform-node, plus a boundaries policy for `import("node:…")` types, which the built-in rule does not see |
| `effect` | `effect`, `<package>/effect` and the package's own `src/effect.ts` only in the allowed paths | Boundaries policies: the allowed paths by file path, `src/effect.ts` as a file category |
| `dynamic-import`, `shell-entry`, `source-file` | `import()` needs a literal specifier; shell entries re-export names one by one; only `.ts` under `src/` | `no-restricted-syntax` from `oxlint-plugin-eslint`; the shell entries' sources also through a boundaries policy |
| `undeclared-package` | Every workspace package under `packages/` is declared in the manifest | Elements exist only for declared packages, so `boundaries/no-unknown-files` reports the sources of an undeclared one; the manifest test checks pnpm's project list |
| `package-dependency` (manifests) | The `workspace:` dependencies declared in each `package.json` are allowed, whether or not they are imported | The manifest test, against the matrix of `boundaries.ts` |
| `entry-file`, `parse` | Package entry files exist; sources parse | `entry-file`: the manifest test. `parse`: oxlint's parser on every run |

- **The agent-marker rule** is new. It applies to the non-test source of the six contexts (catalog, discovery, sessions, harness, acp, cost); the marker list in `infra/architecture`, the providers and the shell are outside its scope. It is two `no-restricted-syntax` selectors: a `Literal` whose whole value is a marker, except a module specifier, and a `TemplateElement` with a marker between `/`, the start and the end of its text. It reports a value that equals a marker exactly, never a substring of a longer value:
  - a string literal or a string literal type whose whole value is a marker;
  - a piece of a template literal's static text (each part between expressions, split on `/`) that is a marker, so `` `${home}/.claude/settings.json` `` and `` `${name}codex` `` report.

  Import and export specifiers are not checked; the boundary rules cover them. Comments and tests are not checked. Exact matching keeps words such as `invalid-cursor` and `api` from reporting.
  - From batch 3 to batch 11 its list is `agentMarkers` in `boundaries.ts`: the seven ids plus `.claude`, `CLAUDE_CONFIG_DIR` and `CURSOR_VERSION`. It also matches string literal types, so the id unions are caught.
  - Until the code moves, it exempts exactly the files that hold agent knowledge on batch 3's base:
    - `domain/*/adapters/` and sessions' `session-adapters/` and `usage-decoders/`, until batch 12;
    - `harness/src/domain/lifecycle/policies/host-sniffing.ts`, until batch 4 removes it;
    - `catalog/src/domain/coding-agent/value-objects/coding-agent-id.ts` (the id unions), until batch 12. Batch 4 removes `CodingAgentIdWithHome`; `BuiltinCodingAgentId` stays until the identity table goes (3.4).

    On batch 3's branch the whole-repository lint reports nothing outside this list. Each later batch removes the exemptions for the code it moves.
  - From batch 12 the list is computed in `lint.ts` from the providers' `facts.ts`, the constant is deleted, and the exemptions end.
  - The rule catches hand-written ids, directories and environment variable names. It cannot catch agent knowledge without a marker, such as branching on Claude's `notification_type` field; `authoring.md` states that this is a review item.
- **Where the configuration lives.** The configuration is specific to this repository, so it stays out of the shared lint-config. `pnpm -r run lint` runs `vp lint` in each package, and oxlint then reads only that package's `lint` block (a root block would apply only to packages without one), so each package's `vite.config.ts` passes its block through `withBoundaryLint` from `infra/architecture/lint.ts`. The manifest test checks every package under `packages/`, including nested providers: its lint script must run whole-package `vp lint`, its block must keep the generated overrides last and in order, and it may ignore only build output (`dist/**`). The plugins are devDependencies of `infra/architecture`.
- **Fixtures.** Every rule has cases that violate it and cases that do not (`infra/architecture/lint-cases.ts`). `run-lint-cases.ts`, part of `pnpm run test`, lints them in a temporary copy of the repository and asserts the exact rule ids, so a run never writes into the working tree. This matters because eslint-plugin-boundaries classifies an import it cannot resolve as external and skips it silently.
- **The spike** (task 1.1) settled the resolver (`eslint-import-resolver-typescript`), that `dependency.kind` separates type-only imports, and the lint time; Appendix C records the verdict. Tool versions must have been published at least 14 days earlier, except the explicitly required oxlint companion alignment recorded in Appendix C.

### 3.10 Compatibility and migration

No compatibility layer. 0.20.0 changes:

- The seven `builtinXxx` tables are replaced by `builtinProviders` and the shell's service tables. `isBuiltinCodingAgentId` and `BuiltinCodingAgentId` stay exported from `/catalog` (3.4).
- Per-agent exports such as `translateCodexRecords`, `CLAUDE_CODE_CAPABILITIES` and `claudeCodeUsage` are removed.
- Override options (`adapters`, `dialects`, `profiles`) are replaced by `providers?: readonly Provider[]`, merged by agent id and service.
- `resolveHome` and `CodingAgentIdWithHome` are removed. `parseCodingAgentId` and `homeRuleOf` take the identity table. The shell exports a bound one-argument `parseCodingAgentId` only if batch 13 finds a consumer (3.4).
- The lease rule functions are no longer exported: `isFresh`, `canAcquire`, `nextFencingToken`, `checkFence`, `holderLiveness` and the other rules in `lease/public.ts`.
- The conformance suites take service tables; the shell's `/testing` binds the built-in ones.
- Names without a consumer are removed (3.8).
- SPI interface types keep their names and shapes but are imported from their service's entry.

What each application uses today and must change:

| Application | Names that change |
| --- | --- |
| agent-presence | `builtinCodingAgents`, `isBuiltinCodingAgentId`, `builtinProbeRecipes`, `builtinHookDialects` |
| agent-task-loop | `builtinCodingAgents`, `isBuiltinCodingAgentId`, `builtinProbeRecipes`, `builtinAcpProfiles` |
| the trace viewer | `builtinSessionAdapters`; the SPI types of its own `SessionAdapter` |

The trace viewer is on 0.14.0 and agent-task-loop on 0.11.0, so their upgrade PRs also absorb the changes between those versions and 0.19.

Change records are written with `pnpm change <pkg> --bump <type> --summary "..."`. The kit is in 0.x, so a breaking change is recorded as `minor`; `major` would release 1.0.0.

### 3.11 Workspace and release

- `pnpm-workspace.yaml` carries over every setting of `common/config/rush/pnpm-config.json`:
  - `autoInstallPeers: true`, `strictPeerDependencies: true`;
  - `minimumReleaseAge: 1440`;
  - the `vite@*` override and `peerDependencyRules.allowAny: [vite]`.

  Shared versions move into a `catalog:` with `catalogMode: strict`. That setting only rejects `pnpm add` of an out-of-range version; it does not make hand-edited versions consistent, and the docs say so.
- `versioning.fixed: [['@rivus/agent-kit', '@rivus/agent-kit-collab']]` and `versioning.changelog.storage: repository`. The second is required: the default `registry` storage keeps consumed records until the registry confirms the release, so the Version Packages PR would never close.
- The Node range moves from `rush.json` to the root `package.json` `devEngines.runtime` (`^24.11.0`, `onFail: error`); `engineStrict` does not check the root package.
- **The lockfile is not re-resolved.** The Rush lockfile's importer paths are rewritten (`../../packages/x` to `packages/x`), and the file moves to the root.
- **`release-state.ts` is kept and ported.** Its three states and its tag logic stay the same. Its inputs change: pending change records are the `.changeset/*.md` files (not the README), and the version is the shared version of the `versioning.fixed` group. If the two published packages disagree on that version, it fails.
- **Workflows.**
  - `version-packages.yml` runs `changesets/action@v2` when the state is `version`, with inputs `version-script`, `commit-message`, `pr-title`, `pr-draft` and `github-token`. The token goes through the input, not `env`. `commit-message: 'chore(release): version packages'` must be quoted, or GitHub rejects the whole file.
  - The action does not publish. `publish-npm.yml` keeps its file name, because npm trusted publishing is bound to it. It keeps its `decide` job, its concurrency re-check, its tagging and its GitHub Release step, and its manual re-publish on `release: published`. It publishes with pnpm, `@rivus/agent-kit` before `@rivus/agent-kit-collab`, because collab names it as a peer.
- **Deleted:**
  - `release-notes.ts` and `lib/release-notes.ts` with their tests, because the action writes the PR body from the CHANGELOG files;
  - `release-intent.ts` and `change:verify`, because the maintainer does not want a CI check for missing change records.

  `check-release.ts` and `lib/workspace.ts` read `pnpm ls -r --depth -1 --json`, as the template's versions do. The template's `check-first-publish.ts` is not copied: both published packages already exist, and providers are private.
- `docs/development/release.md` says in one sentence that this repository releases automatically while the template releases by manual dispatch.
- Dependabot uses one npm entry with `directory: /`. `.github/repo-checks.conf` requires `pnpm-workspace.yaml` instead of `rush.json`.

### 3.12 Security and privacy

Publishing stays on trusted publishing with provenance, from the same workflow file. No new secrets are added. Fixtures stay synthetic.

## 4. Release and rollback

### 4.1 Gates and stages

1. **0.19.1.** The pnpm migration carries one patch change record. Merging it opens a Version Packages PR, and merging that publishes 0.19.1 with the same code as 0.19.0. This is the first real run of `changesets/action` with `pnpm version -r` on GitHub, and of pnpm's publish through trusted publishing; both were only rehearsed locally in the pilot. Later batches wait until 0.19.1 is on npm with provenance.
2. **0.20.0.** Later batches add `minor` change records. The automatic flow keeps one Version Packages PR open and updates it. It is merged only after the last batch in 6.3, once the application check of 5.3 has passed.
3. **Application upgrades.** Each application gets an upgrade PR, which its maintainer merges.

### 4.2 Signals

- The Version Packages PR opens and lists both packages.
- The publish job shows provenance, and `npm view @rivus/agent-kit@<v>` lists the version.
- The consumer smoke test passes in CI.

### 4.3 Rollback

- **A failed publish.** Re-run the publish on the tag through `release: published`.
- **A bad release.** Deprecate it with `npm deprecate` and release a fix; npm does not allow republishing a version.
- **Before 0.20.0 is released**, any batch from 3 on can be reverted with one revert commit; none of them has been published.

## 5. Verification

### 5.1 Functional checks

- Every batch passes the root `check` script (format, build, lint, typecheck, test, package check) and the boundary rules.
- Provider moves change no behavior. Each provider runs its services' conformance suites, and the tests that move with it pass unchanged.
- Domain changes keep the existing tests of each rule that becomes a method. Each new test comes with the output of the test failing when the change is reverted.

### 5.2 Boundary checks

- Each lint rule's violating fixture reports exactly its rule, and its allowed fixture reports nothing. The manifest test has the same pairs.
- Whole-repository lint finds no violations on each batch's tip.

### 5.3 Compatibility checks

- `/harness/events` and `/transcript/usage` still import nothing in their built files. Each provider batch compares every entry with the main commit it is based on; growth over 1% of any entry needs an explanation in its PR, except the expected `/catalog` growth described below. Batch 2 sizes remain historical measurements.
- Until batch 12, the unbundled dist chunk imported by `/catalog` contains each provider's whole `facts.ts`. The measured, tree-shaken bundle retains only identity facts; its size typically grows about 20–30 bytes per provider, though compression and reused facts can offset the net entry growth. Accept and measure this growth here rather than repeating the explanation in each provider PR; keep facts together.
- The pnpm migration changes no shipped byte: the shell's and collab's `dist/` are compared file by file with a build of 821ebcf, and the dry-run pack file lists are compared too.
- **The application check before 0.20.0.** Each application's type check and tests run twice: against the published 0.19.1, and against the locally packed 0.20.0. Every error that appears only in the second run must come from a change listed in 3.10. Errors the first run already has come from the application's older kit version, and its upgrade PR handles them.

### 5.4 End-to-end acceptance

- 0.19.1 is published from the pnpm workspace with provenance.
- 0.20.0 is published.
- Each of the three upgrade PRs passes its repository's CI.

## 6. Execution plan

### 6.1 Preconditions

- This plan is merged.
- The lint spike (task 1.1) has a recorded verdict in Appendix C before batch 3 starts.
- Batch 3 and later start after 0.19.1 is on npm.

### 6.2 Completion contract

- Goals 1–8 of 1.3 hold, each shown by the evidence in 6.4.
- `authoring.md`, `CONTEXT.md`, `AGENTS.md`, `CONTRIBUTING.md`, `docs/development/release.md` and the README describe the result.
- This plan is deleted in the last batch's PR, after its lasting rules have moved into `authoring.md` and the release docs.

### 6.3 Execution order

Each batch is one PR and leaves `main` buildable. A batch that changes shipped code adds a `minor` change record (0.x breaking) or a `patch` record (no API change). A batch that changes or removes a public name also updates every document that names it: `docs/specs/0001-agent-kit.md`, the READMEs, `docs/development/adoption.md` and `authoring.md`.

#### Batch 1: lint spike and the pnpm workspace

**Task 1.1: lint spike** (not merged)

- Files: a spike branch only.
- Change: express the rules of 3.9 as lint configuration and the manifest test. Record which rules fire on violating fixtures, how the resolver behaves, whether `importKind` works, the lint time, and the proposed configuration layout.
- Exit condition: a GO or NO-GO verdict with evidence, recorded in Appendix C by the next PR that touches this plan.

**Task 1.2: move to a pnpm workspace**

- Files:
  - add `pnpm-workspace.yaml`, the root `pnpm-lock.yaml`, `.changeset/` and one change record;
  - change the root `package.json`, `ci.yml`, `version-packages.yml`, `publish-npm.yml` (not renamed), `.github/dependabot.yml`, `.github/repo-checks.conf`, `.gitignore`;
  - change `scripts/release-state.ts`, `scripts/check-release.ts`, `scripts/lib/workspace.ts` and `scripts/lib/workspace.test.ts` (ported, 3.11);
  - change `infra/architecture/workspace.ts` (read `pnpm ls` instead of `rush.json`) and the `rush.json` fixture in `infra/architecture/boundaries.test.ts` (around line 382), so that the existing rule keeps its positive and negative cases;
  - change `AGENTS.md`, `CONTRIBUTING.md`, `README.md`, `docs/architecture/authoring.md` (around line 81, the sentence about Rush rejecting phantom dependencies), `docs/development/release.md`, `docs/plans/0001-agent-kit.md` (only the statements about how the repository builds and releases), `tests/smoke/README.md` and the comment in `packages/agent-kit/scripts/smoke-consumer.ts`;
  - delete `rush.json`, `common/`, the Rush `CHANGELOG.json` files, `scripts/release-notes.ts`, `scripts/lib/release-notes.ts`, `scripts/release-intent.ts` and their tests.
- Change: as described in 3.11. The lockfile is rewritten, not re-resolved. The change record is a patch for `@rivus/agent-kit` stating that the packages are now built and published from a pnpm workspace and the published code is unchanged.
- Tests:
  - the ported `release-state` tests cover the three states with `.changeset` inputs;
  - a dry run of `pnpm version -r` in a throwaway copy adds a `## 0.19.1` section above the existing CHANGELOG contents of both packages;
  - a dry run shows `@rivus/agent-kit` published before `@rivus/agent-kit-collab`;
  - every workflow file parses as YAML.
- Exit condition: 6.4 rows 1.2a–1.2f pass, and CI passes. After the merge, #139 is closed so that Dependabot opens its PRs against the new layout.

#### Batch 2: release 0.19.1

- Change: merge the Version Packages PR that `changesets/action` opens. Record the built sizes of `/harness/events` and `/transcript/usage` from the 0.19.1 tarball.
- Exit condition: 6.4 row 2.

#### Batch 3: boundary rules

- Files:
  - add the boundary lint configuration (`lint.ts`), the manifest test, the case list and its runner under `infra/architecture`; keep `boundaries.ts` as the manifest they read, with the marker list added;
  - change each package's `vite.config.ts` to merge the configuration;
  - delete `check-boundaries.ts`, `workspace.ts` and `boundaries.test.ts`.
- Change: 3.9, with the marker list and the exemptions listed there.
- Tests: a violating and an allowed fixture per rule, including a new unlisted package directory and a forbidden `workspace:` dependency.
- Exit condition: 6.4 row 3.

#### Batch 4: service tables, routing and SPI entries

- Files:
  - catalog: `ServiceTable`, the two lookups, `CapabilityUnsupported`, the identity functions of 3.4, and the removal of `resolveHome` and `CodingAgentIdWithHome` (`BuiltinCodingAgentId` stays until batch 12);
  - each context: `src/spi.ts`, `domain/<concept>/spi/` and `application/spi.ts`, with the SPI interfaces moved out of `value-objects/` and `ports.ts`;
  - every routing site of 1.1, with the `providers` option of 3.3;
  - harness lifecycle: `HostMarkers` in `HookDialect`, `sniffSource` reading the declarations, `host-sniffing.ts` removed;
  - testing: the conformance suites take service tables (3.6);
  - harness's install adapters that call `resolveHome` (`domain/bundle/adapters/*/config-files.ts`);
  - the docs that name changed APIs: `docs/specs/0001-agent-kit.md` (around lines 51–54 and 256–262 for `resolveHome`), `README.md`, `packages/agent-kit/README.md`, `docs/development/adoption.md`;
  - shell: `src/providers/` (the per-service modules, `builtinProviders`, `unsupported.ts`), the `Provider` type and the binding functions.
- Change: 3.3–3.6. The built-in adapters still live in the contexts for now; the shell's per-service modules import them from the contexts' existing tables.
- Tests: both lookups; the merge by id and service for each shell function; the existing host-sniffing cases unchanged; the conformance suites with a given table.
- Exit condition: 6.4 row 4.

#### Batch 5: pi provider (pilot)

- Files: create `packages/providers/pi/`; move pi's identity, discovery recipe, hook dialect, install adapter, usage decoder and session layout facts out of catalog, discovery, harness and sessions, with their tests and fixtures; the shell's per-service modules take pi from the provider's subpaths.
- Change: 3.2. `facts.ts` and `layout.ts` hold every pi fact the moved files used.
- Tests: the moved tests unchanged; the conformance suites for hooks, discovery and usage on the pi provider.
- Exit condition: 6.4 row 5. This batch also confirms that the package layout, the SPI entries and the slim `./hooks` and `./usage` subpaths work as designed. If one does not, this plan is revised before batch 6.

Pilot decisions for batch 5 (apply to later provider batches):

- 3.2/3.9: `providerServices` declares flat service exports; provider packages have no `index.ts` or `public.ts`.
  Manifest checks validate those files and exact exports. Shell lint allows each subpath only in its matching
  service module and checks the slim hooks/usage import lists.
- 3.3: existing published built-in table exports are assembled in the shell during migration, preserving key
  order and data. Catalog's id union and membership check stay backed by a static list until batch 12, so moving
  an identity does not make `isBuiltinCodingAgentId` forget it. Services retain their existing data fields and
  resolve homes through the shell identity table; installer home lookup reads provider facts directly.
- 3.6: usage had no conformance suite. Add an internal runner-agnostic suite in testing and run it in pi; do not
  add a published export without a consumer. Result helpers come directly from catalog's SPI;
  harness SPI exposes the shared agent root alongside the shared skills directory.
- 3.9: allowed test dependencies create workspace cycles. Set `ignoreWorkspaceCycles: true` because internal
  packages export source and have no build step. Lint checks source dependency direction; manifest tests
  require `testsOnly` packages to appear only in `devDependencies` and reject cycles in the graph formed by
  `dependencies`, `peerDependencies` and `optionalDependencies`. Slim entry rules only restrict imports and cannot
  grant SPI or npm access. Cross-agent integration tests remain in their context and assemble providers in test-only
  tables; pi-specific parsing, hook fixtures and usage fixtures move to the provider.

#### Batches 6–11: the other providers

One batch per agent, in this order:

1. cursor (277 lines);
2. gemini-cli (514);
3. opencode (980);
4. grok (1,962): the first provider with sessions, which tests whether the sessions SPI is complete;
5. claude-code (2,273);
6. codex (2,474).

- Files: the same shape as batch 5. grok, claude-code and codex also move their records parsing, session listing, preview and transcript translation.
- Provider tests consume conformance helpers from testing. Cursor's and Grok's cross-agent host-sniffing tests
  stay in testing's or harness's tests, which assemble the full hooks table through `testsOnly`.
  The same applies to unnamed session use cases and cross-agent detection: keep their full session tables in
  testing/harness. Provider tests may import generic test helpers by relative paths into `testing/test/*`;
  these tests-only imports are an accepted pattern, not production API.
- Per-batch sync points (update together when moving an agent):
  - the shell's `src/providers/<service>.ts` tables and its provider devDependency; when moving the first ACP
    profile, also re-export `builtinAcpProfiles` from shell assembly in `src/acp.ts`; when moving the first session
    adapter, also re-export `builtinSessionAdapters` from shell assembly in `src/sessions.ts`; preserve the existing
    per-agent transcript exports through the matching shell service modules until batch 13;
  - `packages/agent-kit/test/provider-bindings.test.ts`: keep `expectedProvider(...)` backed by the shell's complete
    tables as context tables lose their agents;
  - context tables losing the agent, including `Exclude<BuiltinCodingAgentId, ...>` in
    `catalog/src/domain/coding-agent/adapters/index.ts` and `discovery/src/domain/installation/adapters/index.ts`;
  - harness's literal agent unions in `src/domain/lifecycle/adapters/hook-dialects.ts` and
    `src/domain/bundle/adapters/install-adapters.ts`;
  - `harness/test/support/providers.ts` and `testing/test/providers.ts`, which assemble full test tables;
    harness's `foreign-hooks.test.ts`, `plan-evidence-scope.test.ts` and `build-install-plan.test.ts` consume those
    complete tables for foreign-hook integration;
    discovery's `src/application/services/host-paths.test.ts` also needs the moved identity via `testsOnly`
    to keep testing its home override without depending on the shrinking context table; it also reads
    `builtinProbeRecipes.codex` from the context table, which batch 11 must replace;
  - the agent-keyed fixture source/home table in `testing/test/support.ts`, and hook fixture imports in
    `testing/test/hook-lifecycle-sequences.test.ts` and `testing/test/hook-conformance-catches.test.ts`;
    cross-agent fixtures and conformance-suite self-tests stay in testing; session consumers there use the complete
    test sessions table, and ACP recorded/live comparisons stay in testing as their translators move;
    `packages/agent-kit/scripts/smoke-consumer.ts` seeds the packed consumer from those session fixture paths;
  - `infra/architecture/boundaries.ts` (`providerServices`, `spiImports`, `testsOnly`, marker exemptions), package
    manifests and the lockfile; update adapter source links in `packages/discovery/README.md`;
  - boundary cases importing a moved adapter: keep their target resolvable so they still test the intended rule
    (`lint-cases.ts` uses the Claude Code preview for the cross-concept adapter rejection until batch 10).
- Exit condition: 6.4 row 6 for each.

#### Batch 12: provider closeout

- Files:
  - delete the seven built-in tables from the contexts and the identity table from catalog; move `BuiltinCodingAgentId` and `isBuiltinCodingAgentId` to the shell (3.4). In catalog, `CodingAgentId` becomes a plain string type checked by `CODING_AGENT_ID_PATTERN`, and `CodingAgent.id` uses it. The shell's `/catalog` exports `CodingAgentId` as `BuiltinCodingAgentId | (string & {})`, so applications keep editor completion for the built-in ids;
  - add the capability check;
  - write the README support matrix (one row per agent, one column per service) with its test;
  - compute the marker list from the providers' `facts.ts`, delete the constant, and end the exemptions.
- Exit condition: 6.4 row 7.

#### Batch 13: public surface

- Files: the shell entries; each package's `public.ts`; delete the sibling `index.ts` files and the 14 concept `index.ts` files; rewrite imports inside packages.
- Change: 3.8. Collect the applications' imports again (Appendix A) before removing anything.
- Exit condition: 6.4 row 8.

#### Batches 14–18: domain model

One batch each:

1. harness ledger: the entities become classes, absorbing `ownership.ts` and `reconcile.ts`;
2. harness install-plan and bundle: value objects become classes; `planProblem` and `orderSteps` move into InstallPlan's creation, and `planStep` into its factory;
3. collab lease and lanes;
4. acp: `AbsolutePath` and the session value objects;
5. read side: the remaining `policies/` move to `services/` and `lib/`; `pathe` replaces the path helpers; the three `lenient` copies are merged or kept, decided in this batch.

- Change: 3.7 and Appendix B.
- Tests: existing tests unchanged in what they assert. Each moved rule comes with the output of its test failing when the change is reverted.
- Exit condition: 6.4 row 9 for each. After the last of them, no `policies/` folder remains.

#### Batch 19: documentation and 0.20.0

- Files: `authoring.md` (provider packages, the SPI, the service tables, the domain rules, the boundary rules, the review item for markerless agent knowledge), `CONTEXT.md`, and this plan (deleted).
- Change: run the application check of 5.3. Then merge the Version Packages PR, and open the three upgrade PRs.
- Exit condition: 6.4 row 10.

### 6.4 Validation ledger

| Row | Batch | Command or evidence | Expected result |
| --- | --- | --- | --- |
| 1.2a | 1 | Compare resolved versions between the Rush lockfile and the root lockfile | Identical, except pnpm's own bootstrap entries |
| 1.2b | 1 | Build 821ebcf and the branch, then compare `dist/` of `packages/agent-kit` and `packages/agent-kit-collab` file by file | Identical |
| 1.2c | 1 | Dry-run pack of both published packages, before and after | Identical file lists |
| 1.2d | 1 | `pnpm install --frozen-lockfile` on a clean checkout, then the root `check` | Pass |
| 1.2e | 1 | A YAML parser over `.github/workflows/*.yml`; `actionlint` if installed | All files parse |
| 1.2f | 1 | `gh repo-checks repository`; PR CI | Pass |
| 2 | 2 | Version Packages PR; publish job log; `npm view @rivus/agent-kit@0.19.1 --registry https://registry.npmjs.org/` | Opened by the action; published with provenance; listed |
| 3 | 3 | `vp lint` and the manifest test on the fixtures; whole-repository `vp lint` | Each violating fixture reports its rule; no other violations |
| 4 | 4 | Root `check`; the lookup, merge and host-sniffing tests; whole-repository lint with the `host-sniffing.ts` exemption removed | Pass |
| 5 | 5 | Root `check`; pi's conformance runs; built `/harness/events` and `/transcript/usage` imports and sizes | Pass; still no imports; compare every entry against the main commit this batch is based on; growth over 1% of an entry explained in the PR |
| 6 | 6–11 | Root `check`; each provider's conformance runs; every entry's size against the main commit that batch is based on; slim entry imports | Pass; still no imports in slim entries; growth over 1% of an entry explained in the PR |
| 7 | 12 | The capability check; the README matrix test; marker rule over all non-test context source | Pass; no exemptions left |
| 8 | 13 | Shell export list compared with Appendix A plus SPI and testing names; the entry files of 3.8 only | Every remaining export has a recorded consumer |
| 9 | 14–18 | Root `check`; revert outputs for moved rules | Pass; each revert fails its test |
| 10 | 19 | The application check of 5.3; `npm view @rivus/agent-kit@0.20.0` | Every new error comes from 3.10; published |

### 6.5 Rollback per batch

- Each batch is one squash commit and can be reverted alone before 0.20.0 is released, in reverse order.
- Batch 1 is the exception after 0.19.1 is published: reverting it would bring back the Rush release path. A problem found after that is fixed forward.
- Batches 3–19 publish nothing until batch 19 merges the Version Packages PR.

### 6.6 Work split and schedule

| Batch | Owner | Depends on | Effort | When |
| --- | --- | --- | --- | --- |
| 1 | the maintainer's coding agents; the maintainer approves releases | this plan | 1–2 working sessions | unconfirmed |
| 2 | the maintainer | 1 | minutes | unconfirmed |
| 3–19 | the maintainer's coding agents | the previous batch | one to a few hours each; grok, claude-code and codex may need two tasks each | unconfirmed |

## 7. Risks and open questions

| Item | Type | Impact | Owner | Next step or deadline |
| --- | --- | --- | --- | --- |
| The pnpm release path has never run on GitHub | risk | A failure would block a release | PerfectPan | Batch 2 runs it on a release with unchanged code |
| oxlint JS plugins are alpha and outside semver | risk | A vite-plus upgrade could break the boundary rules | PerfectPan | The fixtures fail loudly; read the JS plugin changelog when upgrading vite-plus |
| The boundaries plugin skips imports it cannot resolve | risk | Rules could pass without checking | PerfectPan | Violating fixtures for every rule; the spike checks resolution |
| The sessions SPI is large (about 120 symbols) | risk | Internals become a provider-facing API | PerfectPan | Review the list name by name in batch 4; batch 9 (grok) shows what is missing |
| The hook entry could grow | risk | Hook processes load more code | PerfectPan | The size comparison of 5.3 in every batch |
| 22 workspace packages instead of 15, without a build cache | risk | Slower CI | PerfectPan | Record CI time per batch |
| Context tests that use built-in adapters as fixtures | follow-up | Tests must change when the adapters move | PerfectPan | Use providers through `testsOnly`, or test-only fake providers |
| The lint spike verdict | decided | Decided batch 3's tools | PerfectPan | GO; recorded in Appendix C |

## Appendix

### A. Names the applications use

Collected from the `main` branches of agent-presence, agent-task-loop and the trace viewer on 2026-10-20. Every import comes from a public entry; none reaches into the kit's files.

- `/catalog`: `builtinCodingAgents`, `isBuiltinCodingAgentId`, `CodingAgentId`, `ok`, `err`
- `/discovery`: `detectAgents`, `builtinProbeRecipes`, `DetectAgentsOptions`, `Installation`, `ProbePath`, `ProbeProblem`, `ProbeRecipe`, `ProbeRecipes`, `versionFromOutput`
- `/harness`: `planInstall`, `applyInstall`, `discardPlan`, `doctor`, `inventory`, `verify`, `uninstall`, `locatorKey`, `AgentCli`, `AgentCommand`, `ArtifactFiles`, `Bundle`, `CONFLICT_CHOICES`, `ConflictChoice`, `ExternalOwner`, `FileLedgerRepositoryLive`, `HarnessLive`, `HarnessServices`, `HookSpec`, `InstallPlan`, `JsonValue`, `LedgerRepository`, `LedgerScope`, `PlanConflict`, `PlatformArtifactFilesLive`, `SqliteLedgerLockLive`, `TrustPrompt`
- `/harness/events`: `readHookEvent`, `builtinHookDialects`, `LifecycleEvent`
- `/transcript/usage`: `scanUsage`, `UsageRecord`, `isUsageRecord`, `noCacheInputTokens`
- `/sessions`: `listSessions`, `builtinSessionAdapters`, `isSessionHead`, `sessionAdapterHome`, `SessionAdapter`, `SessionAdapters`, `SessionHead`, `SessionListError`, `SessionPlatform`, `SessionRef`
- `/transcript`: `loadTranscript`, `summarizeSession`, `TranscriptEvent`, `Transcript`, `SessionSummary`, `SESSION_SUMMARY_VERSION`, `Capability`, `Lane`, `LoadTranscriptError`, `PromptSnapshotPayload`, `SessionTarget`, `SourcePointer`, `TranscriptEventKind`, `TranscriptEventOf`, `TranscriptEventPayloads`, `TranscriptSession`
- `/acp`: `connectAgent`, `probeAgent`, `agentEnv`, `builtinAcpProfiles`, `AcpConnection`, `AcpProfile`, `AcpSessionHandle`, `ConnectError`, `FileSessionBindingStoreLive`, `McpServerConfig`, `MemorySessionBindingStoreLive`, `NewSessionError`, `PermissionCallback`, `PermissionDecision`, `PermissionRequest`, `PromptBlock`, `PromptError`, `SessionBindingStore`, `TranscriptStreamPart`
- `/cost`: `createPricing`, `summarize`, `Pricing`
- `/node`, `/node/effect`, `/platform`, `/platform/effect`: `createNodePlatform`, `NodePlatformLive`, `Platform`, `PlatformService`
- `/redact`: `redact`, `redactText`
- `/testing`: `createMemoryPlatform`, `sessionAdapterConformance`, `SessionAdapterFixtures`, `ConformanceSession`, `oversizedSession`

### B. Destinations of `policies/` and `services/`

| Today | Destination |
| --- | --- |
| lease `canAcquire`, `isFresh`, `nextFencingToken`, `lossReason`, `checkFence`, `holderLiveness`, `observe`, `holderExpired` | Methods of Lease and its value objects |
| lanes `admit`, `nextToStart`, `wakeResult` | Methods of Lane and `LaneLimits` |
| ledger `holds`, `release`, `recordOperation`, `unionAgents`, `agentsOfEntries`, `reconcilePending` | Methods of the Ledger and its entities |
| install-plan `planProblem`, `orderSteps` | InstallPlan creation |
| install-plan `planStep` | InstallPlan's factory |
| acp `parseAbsolutePath`, `formatAbsolutePath`, `isWithin` | A new value object, `AbsolutePath` |
| harness `threeWayVerify`, `verifyOwner`, `markAcknowledged`, `conflictChoices`, `registrationCommands`, `chooseStrategy`, `strategyRequirement`, `strategyUnsupported`, `requiredCommands`, the legacy-ownership functions, `hasLegacyMarker`, `isLegacyArtifact`, `hookHealth`, `duplicateHooks`, `heartbeatSignal`, `reduceLifecycle`, `lifecycleStatus`, `readField`, `terminalIdentity` | `services/` |
| harness `sniffSource` | `services/`, reading the providers' host markers (3.5) |
| catalog `homeFromRule` | `services/` |
| discovery `classifyInstallation`, `resolveAuthState`, `envReading`, `probesAuth`, `installationWarnings`, `appBundleMatches` | `services/` |
| sessions transcript rules (compaction shadowing, tool-result pairing, turns, request placement, prompt snapshots, `inheritTimes`, `mergeByTime`) and usage `QUIET_MS`, `decodeIsFinal` | `services/` |
| cost `portionsOf`, `costOf`, `summarize` | `services/` |
| acp `permissionOutcome`, `optionOfKind`, `clientPathVerdict`, `sessionMeta`, `firstPromptBlocks`, `agentEnv` | `services/` |
| `lenient`, `timeOf`, `logTimestamp`, `timeOfValue`, `ownValue`, `rememberKey`, `jsonText`, `shortHash` | `lib/` |
| `joinPath`, `basenamePath`, `dirnamePath`, `belowRoot` | `pathe` |

A function not listed here is placed by the same test: it belongs to one type, it spans several objects, or it has no domain meaning.

### C. Lint spike verdict

Task 1.1 ran on the Rush layout; the maintainer chose the lint approach on 2026-10-20 after reviewing its costs.

- **Verdict: GO.** Every rule of the old checker has a home. Lint covers the import rules (`layer`, `deep-import`, `relative-escape`, `public-entry`, `external-dependency`, `types-only`, `package-dependency` for imports, `node-builtin`, `effect`, `shell-entry`, `dynamic-import`, `source-file`), `undeclared-package` for source files, and `parse` through oxlint's parser. The manifest test keeps what has no source file: undeclared packages in pnpm's project list, `workspace:` dependencies in `package.json`, and the entry files. The spike's 112 checks each reported exactly the expected rule id.
- **Resolver**: `eslint-import-resolver-typescript` resolves this repository's TypeScript 7 code (`.js` specifiers to `.ts` files); the node resolver left 391 imports in sessions unresolved. `dependency.kind` separates declaration-level `import type` from value imports.
- **Cost**: a generator of about 550 lines (`lint.ts`) and five added devDependencies of `infra/architecture`: eslint-plugin-boundaries 7.2.0, eslint-import-resolver-typescript 4.4.5, oxlint-plugin-eslint 1.88.0, eslint 10.12.0 (only as their peer, never run), and es-toolkit from the workspace catalog. The old checker's oxc-parser dependency was removed. Oxlint calls JS plugins alpha. The spike measured sequential whole-repository `vp lint` at 7.5 s before and 13.1 s after. Batch 3 measured `pnpm run lint` at 7.25–10.67 s before and 10.08–11.55 s after (vite-plus 1.1.0, three runs each). With the aligned 1.88.0 plugin, the 127-case runner took 45.1 s in a standalone invocation and 10.2 s during the full test gate; the 135-case runner took 18.2 s during the focused architecture test and 16.5 s during the full test gate. These runs used installed dependencies, a fresh temporary repository copy and a temporary HOME with agent-home overrides unset; startup and cache state differ, so the runner times are observations, not a before/after performance comparison.
- **Toolchain alignment**: main now uses vite-plus 1.2.0 (oxlint 1.88.0), so batch 3 uses oxlint-plugin-eslint 1.88.0. It was published on 2026-10-13, less than 14 days before this update; matching the bundled oxlint is the required exception to the version-age rule. The other plugin versions stay as tested in the spike. Effect module patterns now live only in `boundaries.ts`, alongside the paths they allow.
- **Batch 2 baseline**: 0.19.1 was published from the pnpm workspace with provenance (#154). Its tarball has `dist/harness/events.js` at 68,666 bytes and `dist/transcript/usage.js` at 170,049 bytes; rows 5 and 6 compare against these.
