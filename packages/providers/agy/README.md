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
