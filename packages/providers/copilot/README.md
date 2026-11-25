# @rivus/agent-kit-provider-copilot

Facts about [GitHub Copilot CLI](https://github.com/github/copilot-cli) (`copilot`, npm `@github/copilot`) for the
agent-kit services, bundled into `@rivus/agent-kit`.

## Facts this package owns (verified on 1.0.114)

- **Home & config**: `~/.copilot` (moved whole by `COPILOT_HOME`): `config.json`, `settings.json`, `mcp-config.json`,
  `hooks/*.json`, `skills/`, and `session-state/<session-id>/events.jsonl` (beside `workspace.yaml`, `plan.md`,
  `session.db`, and `checkpoints/`).
- **Discovery**: probes `copilot --version` (`GitHub Copilot CLI <semver>.`), `config.json`, `settings.json`,
  `mcp-config.json`, and the auth environment variables `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, and `GITHUB_TOKEN`.
- **ACP**: `copilot --acp` serves Agent Client Protocol v1 over stdio.
- **Hooks & install**: `~/.copilot/hooks/<owner>.json` holds `{ "version": 1, "hooks": { "<Event>": [{ "type": "command", "command": "...", "timeout": 30 }] } }`.
  Using PascalCase event names (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`,
  `SubagentStart`, `SubagentStop`, `Stop`, `SessionEnd`) delivers snake_case JSON payloads with `hook_event_name`,
  `session_id`, `cwd`, `transcript_path`, `tool_name`, `tool_use_id`, and `stop_reason`, with `COPILOT_CLI` exported
  in the hook process environment. Skills install under `~/.copilot/skills/<name>`.
- **Usage**: scans `session-state/<session-id>/events.jsonl` and decodes `session.usage_record` (per-request input,
  output, cache read/write, reasoning tokens, model, duration, and `modelCalls` when `requestCount > 1`) plus
  `session.compaction_complete` (`compactionTokensUsed`).

## Sessions (9/10 capabilities)

The adapter declares `requests`, `usage`, `durations`, `reasoning`, `compaction`, `compactionTokens`, `hooks`,
`subagents`, and `systemPrompt`:

- **`requests`, `usage`, `durations`**: `session.usage_record` (`usage.model`, token counts, `duration`, `apiCallId`,
  `providerCallId`, `finishReason`, `requestCount`) and `session.compaction_complete.compactionTokensUsed`
  (with `attemptMetrics.durationMs`).
- **`reasoning`**: `assistant.message` exposes `reasoningText` or opaque reasoning (`reasoningOpaque` /
  `encryptedContent` / `reasoningBlocks`).
- **`compaction` & `compactionTokens`**: `session.compaction_complete` (`trigger`, `preCompactionTokens`,
  `postCompactionTokens`, `summaryContent`), shadowing prior events on the same lane.
- **`hooks`**: `hook.start` / `hook.end` (`hookInvocationId`, `hookType`, `input.tool_name`, `error.message`).
- **`subagents`**: `subagent.started` (`toolCallId`, `agentDisplayName`/`agentName`) registers each subagent lane
  identified by envelope `agentId`; all subsequent records carrying that `agentId` attach to that lane, and
  `subagent.completed` / `subagent.failed` record completion/error metadata.
- **`systemPrompt`**: `system.message` (`content`) records the system prompt on its lane.
- **Upstream ceiling (`toolSchemas`)**: `events.jsonl` does not persist the JSON schemas of tools sent to the model
  (only `toolDefinitionsTokens` count in `session.shutdown` and invoked tool `toolName` / `arguments` in
  `tool.execution_start`), so `toolSchemas` is not declared.
