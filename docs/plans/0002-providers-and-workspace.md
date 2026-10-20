# Provider packages, a service directory and a pnpm workspace

This plan restructures agent-kit in four connected steps. Each coding agent's adapter code moves into one provider package. The contexts route every call through one service directory. The domain model is reclassified along DDD lines. The repository moves from Rush to a pnpm workspace. It also narrows the public surface to names that have a consumer, and replaces the hand-written boundary checker with lint rules. Compatibility is not kept: the result ships as 0.20.0, and the consuming applications update when they upgrade.

- Status: in review
- Owner: PerfectPan
- Reviewer: unconfirmed
- Last updated: 2026-10-20
- Paired Spec: none (a technical refactor; the public API changes are listed in [3.8](#38-compatibility-and-migration))

## Contents

- [1. Background and goals](#1-background-and-goals)
- [2. Outline](#2-outline)
- [3. Detailed design](#3-detailed-design)
- [4. Release and rollback](#4-release-and-rollback)
- [5. Verification](#5-verification)
- [6. Execution plan](#6-execution-plan)
- [7. Risks and open questions](#7-risks-and-open-questions)
- [Appendix](#appendix)

"The trace viewer" is the private browser viewer for agent sessions that [plan 0001](0001-agent-kit.md) names by the same role. Counts and file references are from `main` at 821ebcf.

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
| codex | ● | ● | ● | ● | ● | ● | ● | 18 | 2,591 |
| claude-code | ● | ● | ● | ● | ● | ● | ● | 18 | 2,536 |
| grok | ● | ● | ● | ● | ● | ● | ● | 16 | 2,283 |
| opencode | ● | ● | ● | ● | – | ● | ● | 10 | 980 |
| gemini-cli | ● | ● | ● | ● | – | ● | ● | 9 | 514 |
| pi | ● | ● | ● | ● | – | ● | – | 8 | 404 |
| cursor | ● | ● | ● | ● | – | – | – | 5 | 277 |

"Sessions" means session listing and transcripts (`SessionAdapter`). The counts cover the agent-named files under `domain/*/adapters/` and under sessions' `application/services/{session-adapters,usage-decoders}/`, without tests. Helpers shared by several agents add about 960 lines.

**The coupling runs by agent.** One agent's files import each other across concepts. Claude Code's `transcript/adapters/claude-code/events.ts` imports `usage/adapters/claude-code` and `session/adapters/claude-code/layout`, and the usage file imports the transcript's `record.ts`. Codex and Grok do the same. No file of one agent imports a file of another agent.

**Agent facts are duplicated or leak out of the adapter folders:**

- Claude Code's session directory `<home>/projects` is written in both `sessions/src/domain/session/adapters/claude-code/layout.ts:14` and `discovery/src/domain/installation/adapters/claude-code.ts:59`.
- `BuiltinCodingAgentId` in catalog spells out the seven ids.
- `harness/src/domain/lifecycle/policies/host-sniffing.ts` names cursor and grok and reads `CURSOR_VERSION`.
- sessions' `public.ts` exports per-agent names such as `translateCodexRecords` and `CLAUDE_CODE_CAPABILITIES`.

**Routing is written eight times.** Finding the adapter of an agent, and deciding what happens when there is none, happens in eight places:

- sessions: `listSessions`, `loadTranscript`, `decodeUsage`;
- discovery: `detectAgents`;
- harness: `planInstall`, `readHookEvent`, `hook-placement`;
- acp: `connectAgent`.

A caller's override table has three meanings:

- replace the table: `listSessions`, `detectAgents`;
- merge over it: `planInstall`, `readHookEvent`;
- replace one agent's entry: `connectAgent`.

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
- Each package has a `public.ts` and a sibling `index.ts`, and 14 concept folders have an `index.ts` that only re-exports.

**The boundary checker is hand-written.** `infra/architecture/` holds about 1,000 lines:

- `check-boundaries.ts`: 346 lines, 15 rule ids, parses imports with oxc-parser;
- `boundaries.ts`: 169 lines;
- `workspace.ts`: 38 lines, reads the project list from `rush.json`;
- `boundaries.test.ts`: 458 lines.

**The build and release depend on Rush:**

- `rush.json` and `common/`;
- every root script, which goes through `install-run-rush`;
- the three workflows and the release scripts (`release-state.ts`, `release-notes.ts`, `release-intent.ts`, `check-release.ts`);
- the documentation.

Dependabot cannot update Rush's lockfile, and its pull request #139 is stuck on `rush install`. The maintainer decided to move every TypeScript repository from Rush to a pnpm workspace. The trace viewer has already migrated.

### 1.2 Problem

**Adding or fixing one agent touches five packages.** A Claude Code storage change has to be made in both sessions and discovery. Nothing stops agent knowledge from spreading further: the boundary test checks imports, not agent facts.

**Every context re-implements routing**, with different override semantics and errors.

**The model folders do not say what their contents are.** Aggregate snapshots and adapter contracts sit among value objects, and single-type rules sit apart from their types.

**Most exported names have no consumer.** Each one is still an API that cannot change without a breaking release.

**Rush blocks routine maintenance.** Dependabot cannot run, and the release scripts duplicate what pnpm and `changesets/action` provide.

### 1.3 Goals and success criteria

1. Each built-in agent's adapter code and facts live in one package, `packages/providers/<agent>`. Outside it, the only per-agent code is the agent's line in the shell's service directory.
2. No context source file (outside tests) contains a built-in agent id or another agent marker string; a lint rule fails when one does.
3. Every capability lookup goes through one function in catalog. Override tables have one meaning: merge by agent id.
4. The model follows [3.5](#35-context-layout-and-the-domain-model):
   - write-side value objects and entities are classes;
   - read-side value objects are plain data;
   - no `policies/` folder remains;
   - no adapter contract sits in `value-objects/`.
5. Each shell export has a consumer: an application, a third-party provider, or the testing entry. Each package has at most two entry files, `public.ts` and `spi.ts`.
6. The boundary rules run as lint rules in `vp lint`, each with a fixture that violates it and one that does not.
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
- Changing what any use case does, beyond the API changes listed in [3.8](#38-compatibility-and-migration).

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
   │ looks up the service directory: which provider serves this agent?
   ▼
provider packages (one per agent): implement the SPI
```

| Term | Meaning |
| --- | --- |
| Context | One of catalog, discovery, sessions, harness, acp, cost. It owns a model and its use cases. |
| Application interface | A context's `public.ts`, published through the shell. |
| SPI | The interfaces a context requires providers to implement, plus the helpers for writing a provider. The entry file is `spi.ts`. |
| Service | One of seven capabilities: identity, discovery, hooks, install, sessions, usage, ACP. Each has one SPI interface with a version literal. |
| Provider package | One per agent. It implements the services that agent supports. |
| Service directory | One table per service, keyed by agent id, assembled in the shell from the providers. |

A context can provide several services:

- sessions provides sessions and usage, because usage decoding shares each agent's rules with its transcript translation;
- harness provides hooks and install, because both use the HookDialect.

The context is the unit of model ownership, and the service is the unit of capability and routing.

### 2.3 Main path

The application calls a shell entry, for example `listSessions(platform, options)`. The shell function adds the built-in session providers, merged under the caller's `providers` by agent id. The context's use case asks catalog's lookup for each agent's provider. A missing provider becomes `CapabilityUnsupported` in the data, or an `AgentKitError` when the caller named that agent. The provider reads the agent's files through the injected Platform and translates them into the context's model.

### 2.4 Design decisions

| Decision | Chosen | Alternatives and why not |
| --- | --- | --- |
| Where adapter code lives | One package per agent, `packages/providers/<agent>`, named `@rivus/agent-kit-provider-<agent>` | Per-concept `adapters/` folders (today): one agent's code spreads over five packages. One `agents` package with a folder per agent: package boundaries enforce what folders cannot. |
| Publishing providers | Private, bundled into the shell | Separate npm packages: every current consumer uses every agent, and seven more release units cost more than they return. |
| Routing | A static service directory assembled in the shell, plus one lookup function in catalog | A global registry or runtime registration: `authoring.md` forbids a global registry, and several installed copies of the kit would each hold their own state. |
| Defaults | Use cases require the provider table; about nine one-line shell functions bind the built-in providers | Contexts importing the providers: a cycle. Splitting each context into a "model + SPI" package and a "use cases" package: twice the packages for the same result. |
| SPI interface names | Keep the domain names (`HookDialect`, `SessionAdapter`, `ProbeRecipe`, `InstallAdapter`, `UsageDecoder`, `AcpProfile`, `CodingAgent`) | Renaming to `XxxProvider`: the names say what each interface is; "provider" names the package that bundles them. |
| Write-side model | Classes, crossing the boundary as snapshots (`toSnapshot()` / `restore()`); a DTO only where a public shape must differ from the snapshot | Plain data with rules in `policies/` (today): behavior sits away from its type. A DTO layer everywhere: mapping code with no consumer. |
| Read-side model | Plain-data value objects; behavior in domain services | Classes: every event would need a DTO before reaching the application. "Read models": the read-only contexts have no write model; this data is their domain model. |
| `policies/` | Removed: single-type rules become methods, cross-object rules become domain services, utilities move to `lib/` | Keeping it: it does not match DDD's Policy (a replaceable strategy). In this kit the per-agent tables are the strategies. |
| Boundary checker | Lint rules in `vp lint`: eslint-plugin-boundaries through oxlint's JS plugins, plus built-in rules ([3.7](#37-boundary-rules-as-lint-rules)) | ast-grep plus dependency-cruiser: two more tools, and the agent marker list would live in YAML. Keeping the checker: about 1,000 lines of custom code. The fallback, if the lint spike fails, is ast-grep plus dependency-cruiser. |
| Workspace and release | pnpm workspace; `.changeset/*.md`, `pnpm version -r`, `changesets/action@v2` | Rush: no maintained release-PR action, Dependabot cannot run, and the maintainer decided to leave it. |
| Release trigger | Automatic: a push to `main` with change records opens or updates the Version Packages PR, and merging it publishes | The template's manual dispatch with a GitHub Release trigger. The automatic flow was chosen on 2026-10-07 and matches how `changesets/action` works. |

## 3. Detailed design

### 3.1 Repository layout and dependency rules

```text
pnpm-workspace.yaml        members: packages/*, packages/providers/*, infra/*, tests/*, scripts
packages/
  agent-kit/               the shell: the only published entry point of @rivus/agent-kit
  providers/<agent>/       one private package per built-in agent
  catalog/  discovery/  sessions/  harness/  acp/  cost/
  platform/  platform-node/  redact/  testing/
  agent-kit-collab/        published in lockstep with @rivus/agent-kit
infra/architecture/        the boundary lint configuration and its fixtures
tests/smoke/  scripts/
```

Dependency rules (enforced by [3.7](#37-boundary-rules-as-lint-rules)):

- The shell may depend on providers and contexts.
- A provider may depend on catalog, platform (port types only), each context's `spi.ts` entry and `zod/mini`.
- A context may not depend on any provider.
- A provider may not depend on another provider.
- testing and the contexts' tests may use providers through `testsOnly`.
- pnpm's isolated `node_modules` also makes an undeclared import fail to resolve.

### 3.2 Provider packages

```text
packages/providers/claude-code/
  package.json        "name": "@rivus/agent-kit-provider-claude-code", "private": true
  src/
    facts.ts          the agent's facts, written once (home rule, session directories, credential and configuration
                      files, environment variables, command names) and its marker strings for the lint rule
    identity.ts       CodingAgent entry
    discovery.ts      ProbeRecipe
    hooks.ts          HookDialect, exported as ./hooks
    install.ts        InstallAdapter
    usage.ts          per-line usage decoding (pure), exported as ./usage
    usage-decoder.ts  UsageDecoder (reads files)
    sessions/         SessionAdapter: listing, preview, transcript translation
    acp.ts            AcpProfile
    index.ts          the provider descriptor: which services this agent provides
  test/               the agent's tests and fixtures; runs each service's conformance suite
```

- A provider creates only the files of the services it supports. The shell's service directory records why a service is unsupported.
- `hooks.ts` and `usage.ts` import only `facts.ts` and SPI entries. The hook entry `/harness/events` imports only `<provider>/hooks`, and the zero-dependency entry `/transcript/usage` imports only `<provider>/usage`, so neither pulls in session translation code.
- Relations between agents are declared by agent id, not by import. Grok and Cursor also run Claude Code's hooks; they declare that in their own HookDialect.
- `host-sniffing.ts` is replaced by host markers that each provider declares in its HookDialect (for example an environment variable). The domain service reads the declarations.
- Formats shared by several agents belong to no provider. They are SPI helpers of the context that reads them, named by format:
  - the ACP `session/update` translation (sessions);
  - the Claude-style hook configuration that Codex, Gemini CLI and Grok copy (`commandHook`, `groupedHooksFile`, harness);
  - the `~/.agents/skills` directory that every agent except Claude Code reads (harness);
  - the base ACP environment (acp).

### 3.3 Service directory and routing

- **The service directory.** The shell's `src/providers.ts` lists the built-in providers. It builds one table per service (`ServiceTable<HookDialect>` and so on, keyed by agent id) and exports them together as `builtinProviders`. `BuiltinCodingAgentId` and `isBuiltinCodingAgentId` are derived from this list and leave catalog.
- **The lookup.** catalog gains one lookup function, and `CapabilityUnsupported` moves from sessions to catalog. The rule is written once:
  - data that names an agent without a provider yields a `CapabilityUnsupported` value, and the call goes on;
  - a call whose options name an agent without a provider throws `AgentKitError` with code `capability-unsupported`.

  The eight routing sites use it.
- **Overrides.** The per-call option is named `providers` everywhere. It is merged over the built-in table by agent id.
- **Defaults.** Context use cases require the table. The shell binds the built-in providers:

  ```ts
  // packages/sessions (illustrative)
  export function listSessions(
    platform: SessionPlatform,
    options: ListSessionsOptions & { readonly providers: ServiceTable<SessionAdapter> },
  ): AsyncIterable<SessionListItem>

  // packages/agent-kit/src/sessions.ts
  export const listSessions = (platform: SessionPlatform, options: ListSessionsOptions = {}) =>
    sessions.listSessions(platform, { ...options, providers: { ...builtinSessionProviders, ...options.providers } })
  ```

  This ends the rule that shell entries only re-export names; `authoring.md` changes with it.
- **The capability check.** A test requires each built-in agent to either implement each service or have a recorded reason for not supporting it. Another test keeps the README support matrix equal to the directory.

### 3.4 SPI entries

- Each context's `spi.ts` exports its SPI interfaces and the helpers providers need. For sessions this is about 120 symbols today:
  - the transcript model and event factories;
  - the session model;
  - the usage ports;
  - the ACP update translation;
  - the file helpers `walkFiles`, `readJsonlRecords`, `readBytes`, `readEdges`, `catchIoFailure`, `discoverSessions`, `decodeJsonlUsage`;
  - the `turns`, `request-placement` and `fold-transcript` rules.

  The list is reviewed name by name when the entry is created.
- SPI interface types are public through their service's entry, because the trace viewer implements its own `SessionAdapter` and runs `sessionAdapterConformance`. SPI helpers stay internal until a third-party provider needs one.
- Pure SPI interfaces (`HookDialect`, `InstallAdapter`, `ProbeRecipe`, `AcpProfile`) live in `domain/<concept>/spi/`. Interfaces that read files (`SessionAdapter`, `UsageDecoder`) live in `application/spi.ts`. `application/ports.ts` keeps only ports that the kit's own `infra/` implements.

### 3.5 Context layout and the domain model

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

The domain folders no longer have `adapters/`, so the name no longer clashes with `infra/adapters/`.

| Side | Scope | Value objects | Across the boundary |
| --- | --- | --- | --- |
| Write | harness bundle, install-plan, ledger; acp; collab lease and lanes | Classes that validate on construction and carry their rules | Snapshots, through `toSnapshot()` / `restore()` |
| Read | sessions, discovery, cost, catalog; harness lifecycle | Plain data; behavior in `services/` | The data itself |

- **Aggregates are unchanged.** InstallPlan, Ledger, AcpSession, Lease and Lane keep their shape.
- **Entities.** Only the Ledger has entities: `LedgerEntry`, `PendingOperation`, `KeptArtifact`. They become classes, for example `entry.heldBy(owner)` and `pending.resolve(actualHash)`, absorbing `ownership.ts` and `reconcile.ts`. No other aggregate tracks children by identity: AcpSession counts turns and pending permissions, Lane keeps a state and a pending flag, and InstallPlan steps never change after creation.
- **Sessions are value objects.** A session has an identity in the agent, but the kit reads moments of it and does not track its changes. `SessionRef` is an identifier, and `SessionHead` and `SessionSummary` are descriptions of a moment. This changes when the kit keeps its own session index.
- **Where today's `policies/` and `services/` functions go** is listed in [Appendix B](#b-destinations-of-policies-and-services).
- **`lib/`** holds only pure functions:
  - `lenient` (three copies today);
  - `timeOf`, `logTimestamp`, `timeOfValue`;
  - `ownValue`, `rememberKey`, `jsonText`;
  - `shortHash`, a hand-written cyrb53 hash kept because no small library fits; its comment says so.

  Code that needs a Node capability is not `lib/`. It takes the capability through the Platform port (a `Pick<Platform, ...>` first parameter in plain contexts, `PlatformService` in Effect contexts) and lives in `application/services/` or `infra/`. A missing capability is added to Platform and implemented by platform-node and the memory platform, as `fs.mkdir` was.
- **Paths.** `joinPath`, `basenamePath` and `dirnamePath` exist only because the domain cannot import `node:path`. They are replaced by `pathe` 2.0.3 (pure, no dependencies); `belowRoot` becomes `pathe`'s `relative` plus a prefix check.

### 3.6 Public surface

- A shell export needs a consumer: an application, a third-party provider (SPI interface types), or the testing entry. Option and result types that only appear in signatures are not exported by name; callers derive them with `Parameters` and `ReturnType`, as `authoring.md` already says.
- The pruning starts from the 456 names and the 107 that the applications use (Appendix A), and keeps the SPI interfaces and the testing suites.
- Each package keeps at most `public.ts` and `spi.ts`. The sibling `index.ts` files and the 14 concept `index.ts` files are removed: siblings use `public.ts` or `spi.ts`, and files inside a package import the defining file directly.

### 3.7 Boundary rules as lint rules

`vp lint` runs oxlint, which loads ESLint plugins through `jsPlugins` (alpha since 2026-03, outside semver). vite-plus 1.1.0 already depends on `@oxlint/plugins`.

| Rule (today's id) | Implementation |
| --- | --- |
| `layer`, `deep-import`, `relative-escape`, `package-dependency`, `public-entry`, `external-dependency`, `types-only`, and the new provider rules of 3.1 | eslint-plugin-boundaries: element types by path (each context layer, providers, shell, platform-node), `dependencies` policies, `entry-point`, `external`, and `importKind` for type-only imports |
| `node-builtin`, `effect` | oxlint's built-in `no-restricted-imports` with `overrides` per directory |
| `dynamic-import` (non-literal `import()`), `export *` in shell entries, and the new agent-marker rule | `no-restricted-syntax` from `oxlint-plugin-eslint`, or a short rule written with `@oxlint/plugins` |
| `undeclared-package` | pnpm's isolated `node_modules` makes the import unresolvable, so `tsc` fails |
| `entry-file`, `source-file`, `parse` | Covered by publint, attw or `check:package` where they already check the same thing; otherwise a small script (decided by the spike in task 1.1) |

- **The agent-marker rule.** It matches string literals and template-literal parts in context source, never comments or tests. Its list comes from the providers' `facts.ts`, computed in the lint configuration (a `vite.config.ts` is code), so a new agent updates it automatically. The rule catches hand-written ids, directories and environment variable names. It cannot catch agent knowledge without a marker, such as branching on Claude's `notification_type` field; `authoring.md` states that this is a review item.
- **Where the configuration lives.** The configuration is specific to this repository, so it stays out of the shared lint-config. `infra/architecture` exports it, and each package's `vite.config.ts` merges it with the shared `lint`.
- **Fixtures.** Every rule has a fixture that violates it and one that does not, and a test lints them and asserts the expected rule ids. This matters because eslint-plugin-boundaries classifies an import it cannot resolve as external and skips it silently.
- **Fallback.** If the spike is NO-GO: ast-grep for the single-file rules, dependency-cruiser for the rules that need resolved paths, with the same fixtures.

### 3.8 Compatibility and migration

No compatibility layer. 0.20.0 changes:

- The seven `builtinXxx` tables become `builtinProviders`. `isBuiltinCodingAgentId` and `BuiltinCodingAgentId` stay in `/catalog`, derived from the directory.
- Per-agent exports such as `translateCodexRecords`, `CLAUDE_CODE_CAPABILITIES` and `claudeCodeUsage` are removed.
- The override option `adapters` becomes `providers`, merged by agent id.
- The lease rule functions (`isFresh`, `canAcquire`, `nextFencingToken`) are no longer exported.
- Names without a consumer are removed ([3.6](#36-public-surface)).
- SPI interface types keep their names and shapes but are imported from their service's entry.

What each application uses today and must change:

| Application | Names that change |
| --- | --- |
| agent-presence | `builtinCodingAgents`, `isBuiltinCodingAgentId`, `builtinProbeRecipes`, `builtinHookDialects` |
| agent-task-loop | `builtinCodingAgents`, `isBuiltinCodingAgentId`, `builtinProbeRecipes`, `builtinAcpProfiles` |
| the trace viewer | `builtinSessionAdapters`; the SPI types of its own `SessionAdapter` |

Change records are written with `pnpm change <pkg> --bump <type> --summary "..."`. The kit is in 0.x, so a breaking change is recorded as `minor`; `major` would release 1.0.0.

### 3.9 Workspace and release

- `pnpm-workspace.yaml` carries over every setting of `common/config/rush/pnpm-config.json`:
  - `autoInstallPeers: true`, `strictPeerDependencies: true`;
  - `minimumReleaseAge: 1440`;
  - the `vite@*` override and `peerDependencyRules.allowAny: [vite]`.

  Shared versions move into a `catalog:` with `catalogMode: strict`. That setting only rejects `pnpm add` of an out-of-range version; it does not make hand-edited versions consistent, and the docs say so.
- `versioning.fixed: [['@rivus/agent-kit', '@rivus/agent-kit-collab']]` and `versioning.changelog.storage: repository`. The second is required: the default `registry` storage keeps consumed records until the registry confirms the release, so the Version Packages PR would never close.
- The Node range moves from `rush.json` to the root `package.json` `devEngines.runtime` (`^24.11.0`, `onFail: error`); `engineStrict` does not check the root package.
- **The lockfile is not re-resolved.** The Rush lockfile's importer paths are rewritten (`../../packages/x` to `packages/x`), and the file moves to the root.
- **Workflows.**
  - `changesets/action@v2` opens the Version Packages PR, with inputs `version-script`, `commit-message`, `pr-title`, `pr-draft` and `github-token` (the token goes through the input, not `env`). `commit-message: 'chore(release): version packages'` must be quoted, or GitHub rejects the whole file.
  - The action does not publish. `publish-npm.yml` keeps its file name, because npm trusted publishing is bound to it, and runs `pnpm publish -r` with OIDC and provenance. It also keeps the manual re-publish on `release: published`.
- **Deleted:**
  - `release-state.ts`, `release-notes.ts` and `lib/release-notes.ts` with their tests, because the action writes the PR body from the CHANGELOG files;
  - `release-intent.ts` and `change:verify`, because the maintainer does not want a CI check for missing change records.

  `check-release.ts` and `lib/workspace.ts` take the template's versions, which read `pnpm ls -r --depth -1 --json`.
- Dependabot uses one npm entry with `directory: /`. `.github/repo-checks.conf` requires `pnpm-workspace.yaml` instead of `rush.json`.

### 3.10 Security and privacy

Publishing stays on trusted publishing with provenance, from the same workflow file. No new secrets are added. Fixtures stay synthetic.

## 4. Release and rollback

### 4.1 Gates and stages

1. **0.19.1.** The pnpm migration carries one patch change record. Merging it opens a Version Packages PR, and merging that publishes 0.19.1 with the same code as 0.19.0. This is the first real run of `changesets/action` with `pnpm version -r` on GitHub, and of `pnpm publish -r` through trusted publishing; both were only rehearsed locally in the pilot. Later batches wait until 0.19.1 is on npm with provenance.
2. **0.20.0.** Later batches add `minor` change records. The automatic flow keeps one Version Packages PR open and updates it. It is merged only after the last batch in 6.3. Before that merge, the three applications' type checks and tests run against a locally packed kit.
3. **Application upgrades.** Each application gets an upgrade PR, which its maintainer merges.

### 4.2 Signals

- The Version Packages PR opens and lists both packages.
- The publish job shows provenance, and `npm view @rivus/agent-kit@<v>` lists the version.
- The consumer smoke test passes in CI.

### 4.3 Rollback

- **A failed publish.** Re-run the publish on the tag through `release: published`.
- **A bad release.** Deprecate it with `npm deprecate` and release a fix; npm does not allow republishing a version.
- **Before 0.20.0 is released**, any batch can be reverted with one revert commit. Batches 3–19 change nothing that has been published.

## 5. Verification

### 5.1 Functional checks

- Every batch passes the root `check` script (format, build, lint, typecheck, test, package check) and the boundary rules.
- Provider moves change no behavior. Each provider runs its services' conformance suites, and the tests that move with it pass unchanged.
- Domain changes keep the existing tests of each rule that becomes a method. Each new test comes with the output of the test failing when the change is reverted.

### 5.2 Boundary checks

- Each lint rule's violating fixture reports exactly its rule, and its allowed fixture reports nothing.
- Whole-repository lint finds no violations on each batch's tip.

### 5.3 Compatibility checks

- `/harness/events` and `/transcript/usage` still import nothing in their built files, and their sizes do not grow.
- The pnpm migration changes no shipped byte: the shell's and collab's `dist/` are compared file by file with a build of 821ebcf, and the dry-run pack file lists are compared too.
- Before 0.20.0, a locally packed kit runs the three applications' type checks and tests. Type errors may appear only for the names in 3.8.

### 5.4 End-to-end acceptance

- 0.19.1 is published from the pnpm workspace with provenance.
- 0.20.0 is published.
- Each of the three upgrade PRs passes its repository's CI.

## 6. Execution plan

### 6.1 Preconditions

- This plan is merged.
- The lint spike (task 1.1) has a recorded verdict before batch 3 starts.
- Batch 3 and later start after 0.19.1 is on npm.

### 6.2 Completion contract

- Goals 1–8 of 1.3 hold, each shown by the evidence in 6.4.
- `authoring.md`, `CONTEXT.md`, `AGENTS.md`, `CONTRIBUTING.md`, `docs/development/release.md` and the README support matrix describe the result.
- This plan is deleted in the last batch's PR, after its lasting rules have moved into `authoring.md` and the release docs.

### 6.3 Execution order

Each batch is one PR and leaves `main` buildable. A batch that changes shipped code adds a `minor` change record (0.x breaking) or a `patch` record (no API change).

#### Batch 1: lint spike and the pnpm workspace

**Task 1.1: lint spike** (not merged)

- Files: a spike branch only.
- Change: express the 15 rule ids and the agent-marker rule as lint configuration, as in 3.7. Record which rules fire on violating fixtures, how the resolver behaves, the lint time, and the proposed configuration layout.
- Exit condition: a GO or NO-GO verdict with evidence, recorded in Appendix C.

**Task 1.2: move to a pnpm workspace**

- Files:
  - add `pnpm-workspace.yaml`, the root `pnpm-lock.yaml`, `.changeset/` and one change record;
  - change the root `package.json`, the three workflows, `.github/dependabot.yml`, `.github/repo-checks.conf`, `.gitignore`, `scripts/check-release.ts`, `scripts/lib/workspace.ts`, `infra/architecture/workspace.ts` (read `pnpm ls` instead of `rush.json`), `AGENTS.md`, `CONTRIBUTING.md`, `README.md`, `docs/development/release.md`, `docs/plans/0001-agent-kit.md` (only the statements about how the repository builds and releases), `tests/smoke/README.md` and the comment in `packages/agent-kit/scripts/smoke-consumer.ts`;
  - delete `rush.json`, `common/`, the Rush `CHANGELOG.json` files, `scripts/release-state.ts`, `scripts/release-notes.ts`, `scripts/lib/release-notes.ts`, `scripts/release-intent.ts` and their tests.
- Change: as described in 3.9. The lockfile is rewritten, not re-resolved. The change record is a patch for `@rivus/agent-kit` stating that the packages are now built and published from a pnpm workspace and the published code is unchanged.
- Tests:
  - a dry run of `pnpm version -r` in a throwaway copy adds a `## 0.19.1` section above the existing CHANGELOG contents of both packages;
  - every workflow file parses as YAML.
- Exit condition: 6.4 rows 1.2a–1.2f pass, and CI passes. After the merge, #139 is closed so that Dependabot opens its PRs against the new layout.

#### Batch 2: release 0.19.1

- Change: merge the Version Packages PR that `changesets/action` opens.
- Exit condition: 6.4 row 2.

#### Batch 3: boundary rules as lint rules

- Files:
  - add the boundary lint configuration and its fixtures under `infra/architecture`;
  - change each package's `vite.config.ts` to merge it;
  - delete `check-boundaries.ts`, `boundaries.ts`, `workspace.ts` and `boundaries.test.ts`, keeping whatever the spike says stays for `entry-file`, `source-file` and `parse`.
- Change: 3.7. The provider rules and the agent-marker rule are added now. While the adapters still live in the contexts, the marker rule exempts `domain/*/adapters/` and sessions' `session-adapters/` and `usage-decoders/`.
- Tests: a violating and an allowed fixture per rule.
- Exit condition: 6.4 row 3.

#### Batch 4: service directory, routing and SPI entries

- Files:
  - catalog: the lookup function and `CapabilityUnsupported`;
  - each context: `src/spi.ts`, `domain/<concept>/spi/` and `application/spi.ts`, with the SPI interfaces moved out of `value-objects/` and `ports.ts`;
  - the eight routing sites;
  - the use-case option types (`providers`);
  - harness `lifecycle`: host markers in `HookDialect`, replacing `host-sniffing.ts`;
  - shell: `src/providers.ts` and the binding functions.
- Change: 3.3 and 3.4. The built-in tables stay inside the contexts for now, and the shell builds `builtinProviders` from them.
- Tests: the lookup's two outcomes; the merge-by-id override for each use case; the host-marker sniffing cases that exist today.
- Exit condition: 6.4 row 4.

#### Batch 5: pi provider (pilot)

- Files: create `packages/providers/pi/`; move pi's identity, discovery, hook dialect, install adapter, usage decoder and session layout facts out of catalog, discovery, harness and sessions, with their tests and fixtures; the shell's directory now takes pi from the provider.
- Change: 3.2. `facts.ts` holds every pi fact the moved files used.
- Tests: the moved tests unchanged; the conformance suites for hooks, discovery and usage on the pi provider.
- Exit condition: 6.4 row 5. This batch also confirms that the package template, the SPI entries and the slim `./hooks` and `./usage` exports work as designed. If one does not, this plan is revised before batch 6.

#### Batches 6–11: the other providers

One batch per agent, in this order:

1. cursor (277 lines);
2. gemini-cli (514);
3. opencode (980);
4. grok (2,283): the first provider with sessions, which tests whether the sessions SPI is complete;
5. claude-code (2,536);
6. codex (2,591).

- Files: the same shape as batch 5. claude-code and grok also move their sessions, transcript and usage translation.
- Exit condition: 6.4 row 6 for each.

#### Batch 12: provider closeout

- Files:
  - delete the seven built-in tables from the contexts and `BuiltinCodingAgentId` from catalog;
  - add the capability check and the README matrix test;
  - extend the marker rule to all context source.
- Exit condition: 6.4 row 7.

#### Batch 13: public surface

- Files: the shell entries; each package's `public.ts`; delete the sibling `index.ts` files and the 14 concept `index.ts` files; rewrite imports inside packages.
- Change: 3.6.
- Exit condition: 6.4 row 8.

#### Batches 14–18: domain model

One batch each:

1. harness ledger: the entities become classes, absorbing `ownership.ts` and `reconcile.ts`;
2. harness install-plan and bundle: value objects become classes; `planProblem` and `orderSteps` move into InstallPlan's creation;
3. collab lease and lanes;
4. acp: `AbsolutePath` and the session value objects;
5. read side: `policies/` is split into `services/` and `lib/`; `pathe` replaces the path helpers; the three `lenient` copies are merged or kept, decided in this batch.

- Change: 3.5 and Appendix B.
- Tests: existing tests unchanged in what they assert. Each moved rule comes with the output of its test failing when the change is reverted.
- Exit condition: 6.4 row 9 for each. After the last of them, no `policies/` folder remains.

#### Batch 19: documentation and 0.20.0

- Files: `authoring.md` (provider packages, SPI, the service directory, the domain rules, the lint rules, the review item for markerless agent knowledge), `CONTEXT.md`, the README support matrix, and this plan (deleted).
- Change: before merging the Version Packages PR, pack the kit locally and run the three applications' type checks and tests. Then merge it, and open the three upgrade PRs.
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
| 3 | 3 | `vp lint` on the fixtures; whole-repository `vp lint` | Each violating fixture reports its rule; no other violations |
| 4 | 4 | Root `check`; the lookup and override tests | Pass |
| 5 | 5 | Root `check`; pi's conformance runs; built `/harness/events` and `/transcript/usage` imports and sizes | Pass; still no imports; no size growth |
| 6 | 6–11 | Same as row 5 for each provider | Pass |
| 7 | 12 | The capability check; marker rule over all context source | Pass; no exemptions left |
| 8 | 13 | Shell export list compared with Appendix A plus SPI and testing names; no sibling or concept `index.ts` | Every remaining export has a recorded consumer |
| 9 | 14–18 | Root `check`; revert outputs for moved rules | Pass; each revert fails its test |
| 10 | 19 | The three applications' type checks and tests against the packed kit; `npm view @rivus/agent-kit@0.20.0` | Errors only for the names in 3.8; published |

### 6.5 Rollback per batch

- Each batch is one squash commit and can be reverted alone before 0.20.0 is released, in reverse order.
- Batch 1 is the exception after 0.19.1 is published: reverting it would bring back the Rush release path. A problem found after that is fixed forward.
- Batches 3–19 publish nothing until batch 19 merges the Version Packages PR.

### 6.6 Work split and schedule

| Batch | Owner | Depends on | Effort | When |
| --- | --- | --- | --- | --- |
| 1 | the maintainer's coding agents; the maintainer approves releases | this plan | 1–2 working sessions | unconfirmed |
| 2 | the maintainer | 1 | minutes | unconfirmed |
| 3–19 | the maintainer's coding agents | the previous batch | 17–60 minutes per package-sized task, as measured on this repository; grok, claude-code and codex may need two tasks each | unconfirmed |

## 7. Risks and open questions

| Item | Type | Impact | Owner | Next step or deadline |
| --- | --- | --- | --- | --- |
| The pnpm release path has never run on GitHub | risk | A failure would block a release | PerfectPan | Batch 2 runs it on a release with unchanged code |
| oxlint JS plugins are alpha and outside semver | risk | A vite-plus upgrade could break the boundary rules | PerfectPan | The fixtures fail loudly; read the JS plugin changelog when upgrading vite-plus |
| The boundaries plugin skips imports it cannot resolve | risk | Rules could pass without checking | PerfectPan | Violating fixtures for every rule; the spike checks resolution |
| The sessions SPI is large (about 120 symbols) | risk | Internals become a provider-facing API | PerfectPan | Review the list name by name in batch 4; batch 8 (grok) shows what is missing |
| The hook entry could grow | risk | Hook processes load more code | PerfectPan | Size budgets and the dist check in every batch |
| 22 workspace packages instead of 15, without a build cache | risk | Slower CI | PerfectPan | Record CI time per batch |
| Context tests that use built-in adapters as fixtures | follow-up | Tests must change when the adapters move | PerfectPan | Use providers through `testsOnly`, or test-only fake providers |
| The lint spike verdict | open question | Decides batch 3's tools | PerfectPan | Task 1.1; recorded in Appendix C |

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

Batch 13 repeats this collection before it removes anything.

### B. Destinations of `policies/` and `services/`

| Today | Destination |
| --- | --- |
| lease `canAcquire`, `isFresh`, `nextFencingToken`, `lossReason`, `checkFence`, `holderLiveness` | Methods of Lease and its value objects |
| lanes `admit`, `nextToStart`, `wakeResult` | Methods of Lane and `LaneLimits` |
| ledger `holds`, `release`, `recordOperation`, `reconcilePending` | Methods of the Ledger and its entities |
| install-plan `planProblem`, `orderSteps` | InstallPlan creation |
| acp `parseAbsolutePath`, `formatAbsolutePath`, `isWithin` | A new value object, `AbsolutePath` |
| harness `threeWayVerify`, `verifyOwner`, `conflictChoices`, `registrationCommands`, `chooseStrategy`, the legacy-ownership functions, `hookHealth`, `duplicateHooks`, `heartbeatSignal`, `reduceLifecycle`, `readField` | `services/` |
| discovery `classifyInstallation`, `resolveAuthState`, `installationWarnings`, `appBundleMatches` | `services/` |
| sessions transcript rules (compaction shadowing, tool-result pairing, turns, request placement, prompt snapshots, `inheritTimes`, `mergeByTime`) | `services/` |
| cost `costOf`, `summarize` | `services/` |
| acp `permissionOutcome`, `clientPathVerdict`, `sessionMeta`, `agentEnv` | `services/` |
| `lenient`, `timeOf`, `logTimestamp`, `timeOfValue`, `ownValue`, `rememberKey`, `jsonText`, `shortHash` | `lib/` |
| `joinPath`, `basenamePath`, `dirnamePath`, `belowRoot` | `pathe` |
| `host-sniffing.ts` (`sniffSource`, `terminalIdentity`) | Host markers declared by providers; the reading stays a domain service |

### C. Lint spike verdict

Recorded by task 1.1.
