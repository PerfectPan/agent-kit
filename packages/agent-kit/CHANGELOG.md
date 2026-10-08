# Change Log - @rivus/agent-kit

This log was last generated on Thu, 08 Oct 2026 22:27:28 GMT and should not be manually modified.

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

