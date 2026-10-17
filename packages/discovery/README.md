# Discovery evidence

`detectAgents` reports `found` from a command on PATH, an application path, or an agent-owned state path.
Only a successful version probe establishes `runnable`. Configuration evidence uses the existing `config` kind;
its paths are session stores or credential files, not arbitrary configuration. An empty store still counts, and
retained state can establish `found` after the command is removed.

An installer can create an agent home and populate hooks, settings, MCP servers, skills, plugins or extensions
without installing the agent. None of those paths establishes `found`. Built-in `mcpConfigPaths` are empty because
the previously listed MCP files are shared, installer-writable configuration. In particular, `~/.claude.json`
can contain MCP configuration: it remains a source of login state when other evidence exists, but its existence
alone is not installation evidence. Auth variables also do not establish installation.

The table lists every built-in configuration evidence path. Agent-home paths use catalog rules; an override
replaces the default home, rather than probing both. The session/usage fixtures validate the layouts without
reading any local agent data. Credential paths come from the existing login probes; discovery returns only
non-secret authentication facts.

| Agent       | Evidence relative to its data home                                 | Home and overrides                                                                      | Repository sources and reason                                                                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | `projects/`, `.credentials.json`                                   | `~/.claude`; `CLAUDE_CONFIG_DIR` replaces it                                            | [Session layout](../sessions/src/domain/session/adapters/claude-code/layout.ts) stores project transcripts; [credential probe](src/domain/installation/adapters/claude-code.ts) identifies the CLI login file.                                             |
| Codex       | `sessions/`, `archived_sessions/`, `auth.json`                     | `~/.codex`; `CODEX_HOME` replaces it                                                    | [Session layout](../sessions/src/domain/session/adapters/codex/layout.ts) reads active and archived rollouts; [credential probe](src/domain/installation/adapters/codex.ts) reads stored login state.                                                      |
| Gemini CLI  | `tmp/`, `oauth_creds.json`                                         | `~/.gemini`; `GEMINI_CLI_HOME` replaces the parent, yielding `$GEMINI_CLI_HOME/.gemini` | [Session adapter](../sessions/src/domain/session/adapters/gemini-cli.ts) reads chats beneath `tmp`; [credential probe](src/domain/installation/adapters/gemini-cli.ts) names OAuth storage.                                                                |
| Grok        | `sessions/`, `auth.json`                                           | `~/.grok`; `GROK_HOME` replaces it                                                      | [Session layout](../sessions/src/domain/session/adapters/grok/layout.ts) reads session updates and metadata; [credential probe](src/domain/installation/adapters/grok.ts) reads scoped credentials.                                                        |
| opencode    | `opencode.db`, `storage/message/`, `auth.json`                     | `~/.local/share/opencode`; `$XDG_DATA_HOME/opencode` when set                           | [Session adapter](../sessions/src/domain/session/adapters/opencode.ts) reads SQLite and legacy message storage; [credential probe](src/domain/installation/adapters/opencode.ts) reads provider logins. This is the data home, not the plugin/config home. |
| Pi          | `sessions/`                                                        | `~/.pi/agent`; `PI_CODING_AGENT_DIR` replaces it and expands a leading `~`              | [Session adapter](../sessions/src/domain/session/adapters/pi.ts) reads session JSONL.                                                                                                                                                                      |
| Cursor      | `~/.config/cursor/auth.json`, `~/AppData/Roaming/Cursor/auth.json` | Fixed existing CLI credential locations; no catalog home rule                           | [Credential probe](src/domain/installation/adapters/cursor.ts) identifies Linux/Windows login storage; macOS uses the keychain. `CURSOR_CONFIG_DIR` and `XDG_CONFIG_HOME` remain unsupported, as the recipe warning states.                                |

[Catalog home rules](../catalog/src/domain/coding-agent/adapters) and
[`homeFromRule`](../catalog/src/domain/coding-agent/policies/home-from-rule.ts) own override resolution.
[Usage source tests](../testing/test/usage-sources.test.ts) cover all six default layouts and overrides using
[usage fixtures](../testing/test/fixtures/usage). Discovery's
[evidence regression tests](../testing/test/discovery-evidence.test.ts) check each path independently and run
`planInstall`/`applyInstall` over an in-memory home before detection.

These evidence paths are distinct from each harness adapter's write targets:

| Agent       | Installer targets excluded from evidence                                                         | Source                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Claude Code | `skills/`, `settings.json`                                                                       | [Strategies](../harness/src/domain/bundle/adapters/claude-code/strategies.ts) |
| Codex       | `plugins/`, `config.toml`, `hooks.json`, shared skills                                           | [Strategies](../harness/src/domain/bundle/adapters/codex/strategies.ts)       |
| Gemini CLI  | `extensions/`, `settings.json`                                                                   | [Strategies](../harness/src/domain/bundle/adapters/gemini-cli/strategies.ts)  |
| Grok        | `hooks/`                                                                                         | [Strategies](../harness/src/domain/bundle/adapters/grok/strategies.ts)        |
| opencode    | `$XDG_CONFIG_HOME/opencode/plugins/` (default `~/.config/opencode/plugins/`), `opencode.json(c)` | [Strategies](../harness/src/domain/bundle/adapters/opencode/strategies.ts)    |
| Pi          | `extensions/`, `settings.json`                                                                   | [Strategies](../harness/src/domain/bundle/adapters/pi/strategies.ts)          |
| Cursor      | `~/.cursor/plugins/local/`, settings/MCP configuration                                           | [Strategies](../harness/src/domain/bundle/adapters/cursor/strategies.ts)      |

Changing these facts affects every consumer of `detectAgents` with the built-in recipes, including agent-presence,
agent-finder CLI and application setup/detection screens. A machine with only installed hooks or MCP settings now
reports `missing`. Command and application-path detection, custom recipes, and the evidence/status interfaces
remain unchanged.
