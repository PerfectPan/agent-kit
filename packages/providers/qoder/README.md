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
- Sessions and usage (verified against `qodercli` 1.1.88): JSONL transcripts live under
  `~/.qoder/projects/<encoded-cwd>/<sessionId>.jsonl`, with subagent transcripts under
  `<sessionId>/subagents/agent-<agentId>.jsonl`, using Claude Code / Anthropic message and usage shapes
  (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`).
- ACP: `qodercli --acp` (verified on 1.1.88) speaks ACP v1 with loadSession and the unstable session
  list/resume/close/delete/fork surface; the profile documents it with a first-block system prompt.

## Unverified

- The exact exit-code table of command hooks is not published; the dialect follows Claude Code's.
