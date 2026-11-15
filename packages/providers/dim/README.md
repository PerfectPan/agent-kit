# @rivus/agent-kit-provider-dim

Facts about [DimCode](https://dimagent.com) (DimAgent, npm `dimcode`, binary `dim`) for the agent-kit services,
bundled into `@rivus/agent-kit`.

## Facts this package owns

- Data root `~/.dimcode/v2`, moved whole by `DIMCODE_HOME` (the variable names the `v2` directory itself, like
  `PI_CODING_AGENT_DIR` does for Pi); `config.json`, `providers.json`, `auth.json`, `hooks.json`, `mcp.json`,
  `skills/`, and the SQLite database `dimcode.sqlite` (+`-wal`/`-shm`).
- Discovery probes `dim --version`, the database and config/provider files, the auth file, and the catalog's API-key
  environment variables; the project-level `.dimcode/` provider and hook files are not followed (warning).
- Hooks (verified from the CLI's own parser, 0.5.27): `<home>/hooks.json` or project `.dimcode/hooks.json` holds the
  Claude Code grouped shape under a `hooks` key; the command events are SessionStart, SubagentStart, PreToolUse,
  PermissionRequest, PostToolUse, PreCompact, PostCompact, UserPromptSubmit, SubagentStop, Stop; the stdin payload is
  `hook_event_name`, `session_id`, `transcript_path`, `cwd`, `model`, `permission_mode`, `agent_id`, `run_id`; exit
  code 2 blocks. Hooks must be trusted through `dim hooks` (content review), which the dialect records as
  `content-hash`.
- Install writes hooks as grouped `hooks.json` entries (`shared-config`) and skills into `<home>/skills`.
- Usage decodes the insert-only `usage_ledger` (one row per settled event: run, provider, model, usage JSON, cost,
  createdAt) through the sessions SPI's append-log SQLite decoder, keyed by session and run id.
- ACP: `dim acp` (verified on 0.5.27) serves ACP v1 with the session surface, reverse fs/terminal/elicitation, and
  usage notifications carrying `costUSD`; the profile documents it with a first-block system prompt.

## Unverified

- Session transcripts (`sessions` + `messages` tables, `parts` JSON) wait for a real capture; the sessions service is
  not exported yet.
- The hook payload's per-event tool fields and the exact stdout contract beyond exit 2.
