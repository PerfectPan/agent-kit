# Discovery evidence

`detectAgents` reports `found` from a command on PATH, an application path, or an agent-owned state path.
Only a successful version probe establishes `runnable`. Configuration evidence uses the existing `config` kind;
its paths are session stores, application state or credential files, not arbitrary configuration. An empty store
still counts, and retained state can establish `found` after the command is removed.

An installer can create an agent home and populate hooks, settings, MCP servers, skills, plugins or extensions
without installing the agent. None of those paths establishes `found`. Built-in `mcpConfigPaths` are empty because
the previously listed MCP files are shared, installer-writable configuration. In particular, `~/.claude.json`
can contain MCP configuration: it remains a source of login state when other evidence exists, but its existence
alone is not installation evidence. Auth variables also do not establish installation.

The table lists every built-in configuration evidence path. Agent-home paths use catalog rules; an override
replaces the default home, rather than probing both. The session/usage fixtures validate the layouts without
reading any local agent data. Credential paths come from the existing login probes; discovery returns only
non-secret authentication facts.

| Agent       | Evidence relative to its data home                                                                                  | Home and overrides                                                                                                                                          | Sources and reason                                                                                                                                                                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | `projects/`, `.credentials.json`                                                                                    | `~/.claude`; `CLAUDE_CONFIG_DIR` replaces it                                                                                                                | [Session layout](../providers/claude-code/src/layout.ts) stores project transcripts; [credential probe](../providers/claude-code/src/discovery.ts) identifies the CLI login file.                                                                                                                                                               |
| Codex       | `sessions/`, `archived_sessions/`, `auth.json`                                                                      | `~/.codex`; `CODEX_HOME` replaces it                                                                                                                        | [Session layout](../sessions/src/domain/session/adapters/codex/layout.ts) reads active and archived rollouts; [credential probe](src/domain/installation/adapters/codex.ts) reads stored login state.                                                                                                                                           |
| Gemini CLI  | `tmp/`, `oauth_creds.json`                                                                                          | `~/.gemini`; `GEMINI_CLI_HOME` replaces the parent, yielding `$GEMINI_CLI_HOME/.gemini`                                                                     | [Session adapter](../sessions/src/domain/session/adapters/gemini-cli.ts) reads chats beneath `tmp`; [credential probe](src/domain/installation/adapters/gemini-cli.ts) names OAuth storage.                                                                                                                                                     |
| Grok        | `sessions/`, `auth.json`                                                                                            | `~/.grok`; `GROK_HOME` replaces it                                                                                                                          | [Session layout](../providers/grok/src/layout.ts) reads session updates and metadata; [credential probe](../providers/grok/src/discovery.ts) reads scoped credentials.                                                                                                                                                                          |
| opencode    | `opencode.db`, `storage/message/`, `auth.json`                                                                      | `~/.local/share/opencode`; `$XDG_DATA_HOME/opencode` when set                                                                                               | [Session adapter](../sessions/src/domain/session/adapters/opencode.ts) reads SQLite and legacy message storage; [credential probe](src/domain/installation/adapters/opencode.ts) reads provider logins. This is the data home, not the plugin/config home.                                                                                      |
| Pi          | `sessions/`                                                                                                         | `~/.pi/agent`; `PI_CODING_AGENT_DIR` replaces it and expands a leading `~`                                                                                  | [Session adapter](../sessions/src/domain/session/adapters/pi.ts) reads session JSONL.                                                                                                                                                                                                                                                           |
| Cursor      | `User/globalStorage/` beneath each desktop root; `~/.config/cursor/auth.json`, `~/AppData/Roaming/Cursor/auth.json` | Desktop roots: `~/Library/Application Support/Cursor`, `~/.config/Cursor`, `~/AppData/Roaming/Cursor`; fixed CLI credential locations; no catalog home rule | [Cursor support](https://forum.cursor.com/t/custom-modes-where-are-they-saved/124271) identifies the desktop state database in `globalStorage`. The [credential probe](../providers/cursor/src/discovery.ts) identifies Linux/Windows CLI login storage; macOS uses the keychain. `CURSOR_CONFIG_DIR` and `XDG_CONFIG_HOME` remain unsupported. |

Pi remains session-only: the kit has no Pi authentication probe or documented authentication file.

[Catalog home rules](../catalog/src/domain/coding-agent/adapters) and
[`homeFromRule`](../catalog/src/domain/coding-agent/policies/home-from-rule.ts) own override resolution.
[Usage source tests](../testing/test/usage-sources.test.ts) cover all six default layouts and overrides using
[usage fixtures](../testing/test/fixtures/usage). Discovery's
[evidence regression tests](../testing/test/discovery-evidence.test.ts) check each path independently and run
`planInstall`/`applyInstall` over an in-memory home before detection.

Harness artifacts and shared configuration remain excluded:

| Agent       | Paths excluded from evidence                                                                     | Source                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Claude Code | `skills/`, `settings.json`                                                                       | [Strategies](../providers/claude-code/src/install.ts)                        |
| Codex       | `plugins/`, `config.toml`, `hooks.json`, shared skills                                           | [Strategies](../harness/src/domain/bundle/adapters/codex/strategies.ts)      |
| Gemini CLI  | `extensions/`, `settings.json`                                                                   | [Strategies](../harness/src/domain/bundle/adapters/gemini-cli/strategies.ts) |
| Grok        | `hooks/`                                                                                         | [Strategies](../providers/grok/src/install.ts)                               |
| opencode    | `$XDG_CONFIG_HOME/opencode/plugins/` (default `~/.config/opencode/plugins/`), `opencode.json(c)` | [Strategies](../harness/src/domain/bundle/adapters/opencode/strategies.ts)   |
| Pi          | `extensions/`, `settings.json`                                                                   | [Strategies](../harness/src/domain/bundle/adapters/pi/strategies.ts)         |
| Cursor      | `~/.cursor/`, `~/.cursor/plugins/local/`, the three desktop roots' `User/mcp.json`               | [Strategies](../providers/cursor/src/install.ts)                             |

Changing these facts affects consumers of `detectAgents` with the built-in recipes, including agent-presence and
application setup/detection screens. Machines with no command, recognized application or agent-owned state now
report `missing`, including Claude Code with only `~/.claude.json` (macOS keychain login and no session yet), and
machines populated only by hooks or MCP settings. Cursor desktop state still establishes `found` without a CLI.
Command and application-path detection, custom recipes, and the evidence/status interfaces remain unchanged.
