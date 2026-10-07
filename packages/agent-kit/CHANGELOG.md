# Change Log - @rivus/agent-kit

This log was last generated on Wed, 07 Oct 2026 19:57:58 GMT and should not be manually modified.

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

