# @rivus/agent-kit-provider-qoder

Facts about [Qoder CLI](https://qoder.com/cli) (Alibaba, installed by
`curl -fsSL https://qoder.com/install | bash`, binary `qodercli`) for the agent-kit services, bundled into
`@rivus/agent-kit`.

## Facts this package owns

- User config root `~/.qoder` (`QODER_CONFIG_DIR`; the binary also carries `QODER_USER_CONFIG_DIR`), with
  `settings.json`, `oauth_creds.json` and the versioned binary store under `bin/`; the installer puts `qodercli` on
  `PATH` (typically `~/.local/bin/qodercli`).
- Discovery probes `qodercli --version`, the settings and OAuth files, and `QODER_PERSONAL_ACCESS_TOKEN` (PAT from
  qoder.com/account/integrations, per the agent SDK README).
- Hooks (agent SDK protocol types; the CLI ships `qodercli hooks migrate` from Claude Code): grouped entries of the
  user `settings.json` under `hooks`, Claude Code's payload and decision shapes, plus Qoder's own observations
  (`InstructionsLoaded`, `WorktreeCreate/Remove`, `CwdChanged`, `FileChanged`).
- Install writes hooks as grouped `settings.json` entries (`shared-config`) and skills into `~/.agents/skills`.
- Sessions and usage (verified against `qodercli` 1.1.88): see [Sessions](#sessions-qodercli-118).
- ACP: `qodercli --acp` (verified on 1.1.88) speaks ACP v1 with loadSession and the unstable session
  list/resume/close/delete/fork surface; the profile documents it with a first-block system prompt.

## Sessions (qodercli 1.1.88)

Verified against the installed `qodercli` 1.1.88 binary (`~/.qoder/bin/qodercli/qodercli-1.1.88`) and the session
files under `~/.qoder/projects`.

- Layout and shapes: JSONL transcripts live under `~/.qoder/projects/<encoded-cwd>/<sessionId>.jsonl`, with subagent
  transcripts under `<sessionId>/subagents/agent-<agentId>.jsonl`. The record types are `user`, `assistant`, `system`
  and `attachment`, linked by `uuid`/`parentUuid`, with Claude Code / Anthropic content blocks and usage
  (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`).
- Recorded: requests with usage and stop reasons, reasoning blocks, subagent sidechains, compaction boundaries with
  `compactionTokens`, and hooks.
- A `system` record with `subtype: "compact_boundary"` carries `compactMetadata`: `trigger` (`"auto"` or `"manual"`),
  `preTokens`, `postTokens` once the new context was measured, and `messagesSummarized`. Without `preservedSegment`
  the boundary replaces the whole context; with `{headUuid, anchorUuid, tailUuid, messageUuids}` it kept the records
  from `headUuid` through `tailUuid`, which the compaction event leaves unshadowed. The event carries the trigger and
  both counts.
- Hooks leave an `attachment` record only when they have output for the model or a non-silent outcome: `hook_success`
  (stdout for the model; `hookName` is `""` for SessionStart), `hook_output` (additional context, naming its event
  `hookEventName`), `hook_system_message`, `hook_blocking_error`, `hook_non_blocking_error` (`exitCode`, `stderr`,
  `stdout`, `command`, `durationMs`), `hook_error_during_execution`, `hook_cancelled`, `hook_stopped_continuation`
  and `hook_permission_decision`. A tool hook that succeeds silently writes nothing. Each becomes a `hook` event with
  `type`, a non-empty `name`, `event`, and `exitCode` and `durationMs` when recorded; other attachments
  (`queued_command`, `todo_reminder`, …) are skipped as `attachment:<type>`. `hook_started`, `hook_progress` and
  `hook_response` are stdout wire messages, not transcript records.
- Not recorded, so never listed: turn durations (`durationMs` appears on hook attachments only; the CLI keeps its
  `turnTiming` for metrics and writes no `turn_duration` record), the system prompt (it flows into the model request
  and the compaction only) and the tool schemas (the `init` stdout message lists tool names only and no
  `prompt_snapshot` attachment exists).

## Unverified

- The exact exit-code table of command hooks is not published; the dialect follows Claude Code's.
