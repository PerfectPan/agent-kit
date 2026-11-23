# @rivus/agent-kit-provider-agy

Antigravity CLI (`agy`) for @rivus/agent-kit: identity, discovery, hooks, install, sessions, usage and ACP. A private
internal package bundled into the shell; see the repository README for the support matrix.

What this package reads about a 1.5.10 CLI, verified against the binary and bundled `agy-customizations` docs:

- `agy acp` starts the Agent Client Protocol stdio server; the profile launches it and lets hosts answer permission
  requests over the protocol instead of passing `--dangerously-skip-permissions`.
- Files live under the Gemini directory `~/.gemini` (`ANTIGRAVITY_GEMINI_DIR` or `--gemini-dir` relocates it), with
  global customizations under `~/.gemini/config/` (`hooks.json`, `plugins/<name>/`, `skills/<name>/SKILL.md`) and CLI
  runtime state under `~/.gemini/antigravity-cli`.
- Lifecycle hooks use named top-level entries in `hooks.json` (`PreToolUse`/`PostToolUse` grouped with
  `{ matcher, hooks }`; `SessionStart`/`PreInvocation`/`PostInvocation`/`Stop` flat) and camelCase protojson payloads on
  stdin (`hookEventName`, `conversationId`, `cwd`, `transcriptPath`, `artifactDirectoryPath`, `toolCall`).
- Conversations write JSONL step logs to `antigravity-cli/brain/<conversation-id>/.system_generated/logs/`:
  `transcript_full.jsonl` (untruncated, preferred by `sessions`) and `transcript.jsonl` (compact, scanned by `usage`),
  carrying `USER_INPUT`, `PLANNER_RESPONSE`, `GENERIC`, `CHECKPOINT`, `SYSTEM_MESSAGE` and `ERROR_MESSAGE` records with
  per-step `model`, `input_tokens` (non-cached), `cache_read_tokens` and `output_tokens`.

## Sessions

The adapter lists `requests`, `usage`, `reasoning`, `compaction` and `subagents`. Each capability comes from a field the
transcript records; nothing is derived from timestamps or inferred from text. What the five other capabilities would
need, checked against 41 local conversations (8,750 records, 25 subagent spawns) and the files beside their transcripts:

- **Subagents.** A subagent is a conversation of its own. The parent's `invoke_subagent` tool call carries
  `{ Prompt, Role, TypeName }`, and its paired `GENERIC` result names the new conversation in free-form text:
  `Created the following subagent:\n{ "conversationId": …, "logAbsoluteUri": …, "workspaceUris": […] }`. That
  conversation writes the same transcript layout under the same `brain/` root, and its first record is a
  `SYSTEM_MESSAGE` relaying the parent's prompt as `[Message] timestamp=… sender=<parent-id> priority=…
  content=…`; the parent receives its replies as relayed `[Message] sender=<subagent-id>` system messages. `load`
  attaches each spawned conversation as a lane after the root lane, in spawn order, then the lanes they spawn
  (`parentId`, `spawnEventId` on the `invoke_subagent` call, `title` from `Role`; ids and request ids prefixed with the
  lane). A spawn naming the root or a conversation already attached adds no lane; a conversation whose transcript is
  missing or unreadable is an `unavailable` lane. `discover` lists no spawned conversation as a session, while
  `detect` accepts its path and `load` reads it as a root of its own. `summarize` folds the lanes in the same order,
  counts the subagent lanes (unavailable ones too) and takes turns and prompts from the root lane only.
- **Durations.** Each record has one `created_at` and no start, end or elapsed field; a `GENERIC` result's
  `Created At` / `Completed At` lines are the tool's own execution window inside free-form text. Request or turn
  durations from record time differences would be an estimate, so `durationMs` stays out.
- **compactionTokens.** A `CHECKPOINT` carries the summarization request's own `input_tokens`, `cache_read_tokens`
  and `output_tokens` and a `# Resuming from a compaction…` content, but no field naming the context size before or
  after the compaction. The request's usage is already that request's `usage`; reading it as `preTokens` would be an
  interpretation, so both stay out.
- **Hooks.** Hooks are shell commands configured in `hooks.json`; the transcript has no hook record. The only trace
  a hook can leave is a `PostToolUse` `injectSteps.systemMessage`, which persists as an ordinary `SYSTEM_MESSAGE`
  with no hook name, event or exit code, and a notice inside a tool result when a hook rewrote the call's arguments.
- **systemPrompt and toolSchemas.** No transcript record carries the system prompt or the tool definitions sent to the
  model: `tool_calls` hold `name` and `args` only, and no record type holds a request payload. The
  `conversations/<id>.db` SQLite files keep protobuf step payloads and executor metadata (whose strings include
  instruction text and tool names) with no published field layout, which this adapter does not decode; the
  `messages/*.json` files beside a transcript are inter-agent message envelopes, and `logs/chunks/` is byte-identical
  to `transcript_full.jsonl`.
