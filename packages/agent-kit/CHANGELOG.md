# Change Log - @rivus/agent-kit

This log was last generated on Thu, 08 Oct 2026 04:46:15 GMT and should not be manually modified.

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

