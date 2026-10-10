# Change Log - @rivus/agent-kit

This log was last generated on Sat, 10 Oct 2026 15:55:22 GMT and should not be manually modified.

## 0.8.0
Sat, 10 Oct 2026 15:55:22 GMT

### Minor changes

- Export `sessionAdapterHome` from `/sessions`: the home whose roots a session adapter lists, for callers that walk roots themselves.

## 0.7.0
Sat, 10 Oct 2026 13:27:57 GMT

### Patches

- Redaction hides a multi-segment home's project slug after any character that is not a letter, digit, `_` or `%` (e.g. `*-Users-me-proj*`).

## 0.6.0
Sat, 10 Oct 2026 05:42:15 GMT

### Minor changes

- An id-less subagent block now carries its raisedAt, is re-timed on every id-less raise, and expires one TTL after it instead of staying blocked while the main agent keeps working; BlockSource (published through /harness/events) gains the optional field, and entries persisted without it keep the old behavior.

### Updates

- Bump @effect/tsgo to 0.50.0.
- Adopt lint-config v0.5.0 and fix its no-unnecessary-condition findings.
- Move the toolchain to Vite+: build with `vp pack`, lint/format/test through `vp`. The built output is unchanged.
- Carry optional collection defaults once inside the domain. No published type or behavior change.
- Type log record timestamps at the adapter boundary with one shared zod field; parse caught file system errors with a zod object.
- Read record times through one strip-schema parse; classify file system errors without touching non-fs errors' properties.
- Internal refactor: declare functions before their use; no behavior change.
- Adopt lint-config v0.6.0: no-use-before-define checks function declarations.
- Declare functions before their use in the sessions package for the no-use-before-define functions rule.
- Declare functions before their use in @rivus/agent-kit-testing for the no-use-before-define rule

## 0.5.0
Fri, 09 Oct 2026 09:29:24 GMT

### Minor changes

- Catalog and discovery keep only the agents some context supports (claude-code, codex, cursor, gemini-cli, grok, opencode, pi); removed the identities and probe recipes of aider, amp, antigravity, cline, codebuddy, codex-desktop, command-code, github-copilot, hermes, kimi-code-cli, kiro-cli, neovate, openclaw, openhands, qoder, roo-code, trae, vscode-copilot, windsurf and zencoder.

### Patches

- The claude-code session, transcript and usage adapters read the logs through zod/mini schemas, like the other agents; behavior is unchanged.
- Read the Codex session, transcript and usage logs through zod schemas, which grows /sessions, /transcript and /transcript/usage to about 18.8-22.3 kB.
- Grok's log readers and the shared ACP session/update reader parse unknown fields through zod/mini schemas instead of the record-fields accessors, which the grok files no longer import; the grok record is parsed once per reader pass through a full and a slim update schema, and published entry sizes rose with the schemas and their budgets follow.
- Read agent logs through zod schemas; the zero-dependency entries bundle zod/mini into their built files instead of importing it, which grows /transcript/usage to about 16 kB.
- Parse unknown input with zod/mini schemas outside sessions: hook payloads (`/harness/events` reads dialect paths through schemas and stays synchronous, with zod/mini bundled into the built entry), stored ledgers and leases, configuration documents, and caught platform errors. Observed behavior is unchanged, and `/harness/events` grows by about 5 kB of bundled zod.
- Editing a TOML configuration document that holds a big integer no longer throws. `/cost` bundles zod/mini for its LiteLLM price parser and `/node` grows with the platform's error-code schema. redact now recognizes plain objects from another realm and returns objects branded with `Symbol.toStringTag` unchanged.

### Updates

- Move the agent adapters of acp, harness, sessions and discovery into their domain concepts: each file now lives under the `adapters/` of the concept whose model it produces (`domain/<concept>/adapters/`), tables of pure adapters live in the concept's `adapters/`, and sessions' `domain/protocols/` was dissolved into `domain/transcript/adapters/`. The published surface is unchanged.

## 0.4.0
Thu, 08 Oct 2026 22:27:28 GMT

### Minor changes

- Rename the harness ledger store to a repository: `LedgerStore`/`LedgerStoreShape`/`LedgerStoreFailure` are now `LedgerRepository`/`LedgerRepositoryShape`/`LedgerRepositoryFailure`, `FileLedgerStoreLive` is `FileLedgerRepositoryLive`, and the service key is `@rivus/agent-kit/harness/LedgerRepository/v1`; a save over a stale revision now fails with the tagged error `{ _tag: "RevisionConflict", scope, expectedRevision, storedRevision }` — named like the lease repository's, instead of a failure of reason `revision-mismatch`. The file ledger repository passes the aggregate-repository conformance suite from `/testing/effect`.
- Add the `/testing/effect` entry with `aggregateRepositoryConformance`, the generic conformance suite that every aggregate repository implementation runs (missing-id load, first save, stale revisions refused with `RevisionConflict`, strictly increasing revisions, unknown `schemaVersion` refused and kept, reopen for persistent stores); it runs for the lease repositories of `@rivus/agent-kit-collab`.

### Patches

- Move harness business rules (strategy choice, plan evidence scope, registration commands, stale and precondition checks, foreign hook and registration state rules) from application use cases into their owning domain contexts; a restored cli-registration no longer lists an unregister command apply never runs, and doctor's hook audit now also reads other agents' settings files a runner executes that the owner's adapter no longer lists (Claude Code's settings.local.json for Grok).
- Move the verify, uninstall and doctor rules into the harness domain: `verifyOwner` classifies an owner's entries, `Ledger.entriesOf`/`agentsOf` and `InstallPlan.kept` are aggregate queries, and `hookHealth`/`duplicateHooks` carry the doctor findings. Two behavior changes: verify's default agents are now the owner's entry agents in sorted order (they followed ledger order before), which can reorder `VerifyReport` rows and change the agent an error names first; and doctor matches `markers` the way `isLegacyArtifact` does, so a marker that is only whitespace no longer makes every hook command with a space fire twice. No API change.
- The Claude Code and Codex transcript translators take an optional `path` option, and `AuthObservation` allows a credential-file observation to omit its `reading`; both are additive, optional fields.

### Updates

- Adopt lint-config v0.4.0 and fix the no-use-before-define hits it surfaces in bundled internal packages. No API or behavior change.
- Move the acp session-binding ownership check and the client-path verdict into the acp domain. No API or behavior change.
- Align the internal package layout with the types-ddd folder names (domain aggregates/entities, domain/adapters, application use-cases/services, infra). No API or behavior change.

## 0.3.0
Thu, 08 Oct 2026 04:46:15 GMT

### Minor changes

- Add @rivus/agent-kit/cost: createPricing looks prices up in a table the caller passes in (own id, then the longest matching key, with partial overrides and a fallback), costOf prices a UsageRecord (the agent's own cost first, else per bucket with one-hour cache writes, times pricingMultiplier, per model for split records), calendarWindow gives the last N calendar days in a time zone, summarize totals tokens, entries and known cost by agent and model, and fromLiteLLM converts LiteLLM's price list; the entry imports nothing.
- Add the /harness entry (Effect): planInstall, applyInstall, verify, uninstall, inventory and doctor install hooks and skills into Claude Code, Codex, Gemini CLI, Grok, Cursor, opencode and Pi with a ledger, an SQLite ledger lock and format-preserving JSONC and TOML edits; add Platform.fs.mkdir
- Add /redact: redact and redactText hide home directory spellings (POSIX, Windows, file URLs, agent folder names, ~user) and secret-shaped strings.
- Add /acp: drive coding agents over the Agent Client Protocol (connectAgent, probeAgent, ACP profiles for Claude Code, Codex, Gemini CLI, Grok and opencode, session bindings), and foldStreamParts with the live stream part types in /transcript.

### Updates

- Document public entry selection, runtime composition and application adoption.
- Add the harness injection domain (Bundle, InstallPlan, Ledger, three-way verify) without public API

## 0.2.0
Wed, 07 Oct 2026 19:57:58 GMT

### Minor changes

- Add @rivus/agent-kit/transcript/usage: scanUsage, decodeUsage and listUsageSources stream resumable UsageRecords for Claude Code, Codex, Gemini CLI, Grok, opencode and Pi, with noCacheInputTokens, toAiSdkUsage, toOtelAttributes and addUsage; the entry imports nothing. Claude Code requests behind a gateway without request ids now count, keyed by message id, and keep their largest usage.
- Add the /harness/events entry: readHookEvent, reduceLifecycle and the hook dialects of Claude Code, Codex, Cursor, Gemini CLI, Grok, opencode and Pi; add the Cursor identity to /catalog and hookDialectConformance to /testing
- Add the Effect entries /platform/effect (PlatformService) and /node/effect (NodePlatformLive). effect 4.0.1 is an optional peer that only these entries need.
- Add /discovery: detectAgents reports for each of 27 coding agents (agent-finder's 26, with facts corrected against upstream sources, plus Grok) whether it is runnable, found, missing or unknown, with evidence, version, login state and the checks that failed. Login state is read from credential files and variables by default; authProbe: "commands" also runs the agents' status commands, and versionProbe: false skips the version probes. Catalog gains identities for the 21 new agents, with home rules only for the nine whose home upstream documents, so resolveHome now takes CodingAgentIdWithHome. /testing gains probeRecipeConformance and scripted commands for createMemoryPlatform.

## 0.1.0
Wed, 07 Oct 2026 13:02:04 GMT

### Minor changes

- First release: the agent catalog (ids, aliases and home rules for six coding agents, Result, AgentKitError), the Platform port and its Node implementation, session listing and transcripts for Claude Code, Codex and Grok, and testing utilities (in-memory platform, session adapter conformance suite).

