# Discovery evidence

`detectAgents` reports `found` from a command on `PATH`, an application path, or an agent-owned state path.
Only a successful version probe establishes `runnable`. Configuration evidence uses the `config` kind
(and `mcp-config` for agents with dedicated MCP config files); paths are agent-owned stores, state, or credential files
rather than arbitrary shared installer directories. An empty store still counts, and retained state can establish `found`
after the command is removed.

An installer can create an agent home and populate hooks, settings, skills, plugins, or extensions without installing
the agent. Those installer-written paths do not establish `found` (for example, `~/.claude.json` remains a login-state
source when other evidence exists, but its existence alone is not installation evidence). Most built-in recipes leave
`mcpConfigPaths` empty so shared MCP configs do not establish `found`; `copilot` (`mcp-config.json`), `dim`
(`mcp.json`), and `kimi` (`mcp.json`) retain their agent-specific MCP config paths. Auth environment variables never
establish installation.

The table lists every built-in `config` / `mcp-config` evidence path (see each provider's `discovery.ts` as source of
truth). Agent-home paths follow catalog home rules, where an override replaces the default home rather than probing
both. Credential probes return only non-secret authentication facts.

| Agent                          | Evidence relative to its data home                                                                                  | Home and overrides                                                                                                                                                                          | Source                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Antigravity CLI (`agy`)        | `antigravity-cli/settings.json`, `antigravity-cli/history.jsonl`, `antigravity-cli/jetski_state.pbtxt`              | `~/.gemini`; `ANTIGRAVITY_GEMINI_DIR` replaces it                                                                                                                                           | [`agy/src/discovery.ts`](../providers/agy/src/discovery.ts)                 |
| Claude Code (`claude-code`)    | `projects/`, `.credentials.json`                                                                                    | `~/.claude`; `CLAUDE_CONFIG_DIR` replaces it                                                                                                                                                | [`claude-code/src/discovery.ts`](../providers/claude-code/src/discovery.ts) |
| Codex (`codex`)                | `sessions/`, `archived_sessions/`, `auth.json`                                                                      | `~/.codex`; `CODEX_HOME` replaces it                                                                                                                                                        | [`codex/src/discovery.ts`](../providers/codex/src/discovery.ts)             |
| Cursor (`cursor`)              | `User/globalStorage/` beneath each desktop root; `~/.config/cursor/auth.json`, `~/AppData/Roaming/Cursor/auth.json` | Desktop roots (`~/Library/Application Support/Cursor`, `~/.config/Cursor`, `~/AppData/Roaming/Cursor`); no catalog home rule (`CURSOR_CONFIG_DIR` and `XDG_CONFIG_HOME` remain unsupported) | [`cursor/src/discovery.ts`](../providers/cursor/src/discovery.ts)           |
| DeepSeek Harness (`dsh`)       | `sessions/`, `.credentials.yaml`                                                                                    | `~/.dsh`; `DSH_HOME` replaces it and expands a leading `~`                                                                                                                                  | [`dsh/src/discovery.ts`](../providers/dsh/src/discovery.ts)                 |
| DimCode (`dim`)                | `dimcode.sqlite`, `config.json`, `providers.json`; MCP `mcp.json`                                                   | `~/.dimcode/v2`; `DIMCODE_HOME` sets the parent, yielding `$DIMCODE_HOME/v2`                                                                                                                | [`dim/src/discovery.ts`](../providers/dim/src/discovery.ts)                 |
| Gemini CLI (`gemini-cli`)      | `tmp/`, `oauth_creds.json`                                                                                          | `~/.gemini`; `GEMINI_CLI_HOME` replaces the parent, yielding `$GEMINI_CLI_HOME/.gemini`                                                                                                     | [`gemini-cli/src/discovery.ts`](../providers/gemini-cli/src/discovery.ts)   |
| GitHub Copilot CLI (`copilot`) | `config.json`, `settings.json`; MCP `mcp-config.json`                                                               | `~/.copilot`; `COPILOT_HOME` replaces it                                                                                                                                                    | [`copilot/src/discovery.ts`](../providers/copilot/src/discovery.ts)         |
| Grok (`grok`)                  | `sessions/`, `auth.json`                                                                                            | `~/.grok`; `GROK_HOME` replaces it                                                                                                                                                          | [`grok/src/discovery.ts`](../providers/grok/src/discovery.ts)               |
| Kimi Code (`kimi`)             | `sessions/`, `credentials/`; MCP `mcp.json`                                                                         | `~/.kimi-code`; `KIMI_CODE_HOME` replaces it                                                                                                                                                | [`kimi/src/discovery.ts`](../providers/kimi/src/discovery.ts)               |
| opencode (`opencode`)          | `opencode.db`, `storage/message/`, `auth.json`                                                                      | `~/.local/share/opencode`; `$XDG_DATA_HOME/opencode` when set (data home, not plugin/config home)                                                                                           | [`opencode/src/discovery.ts`](../providers/opencode/src/discovery.ts)       |
| Pi (`pi`)                      | `sessions/` (no built-in auth probe or credential file)                                                             | `~/.pi/agent`; `PI_CODING_AGENT_DIR` replaces it and expands a leading `~`                                                                                                                  | [`pi/src/discovery.ts`](../providers/pi/src/discovery.ts)                   |
| Qoder CLI (`qoder`)            | `oauth_creds.json`                                                                                                  | `~/.qoder`; `QODER_CONFIG_DIR` replaces it                                                                                                                                                  | [`qoder/src/discovery.ts`](../providers/qoder/src/discovery.ts)             |
| ZCode (`zcode`)                | `cli/db/db.sqlite`, `~/.zcode/v2/credentials.json` (plus macOS `/Applications/ZCode.app`)                           | `~/.zcode`; `ZCODE_STORAGE_DIR` replaces storage (credentials stay under `~/.zcode/v2/credentials.json`)                                                                                    | [`zcode/src/discovery.ts`](../providers/zcode/src/discovery.ts)             |

[Provider home rules](../agent-kit/src/providers/identity.ts) and
[`homeFromRule`](../catalog/src/domain/coding-agent/services/home-from-rule.ts) own override resolution.
[`packages/testing/test/discovery-evidence.test.ts`](../testing/test/discovery-evidence.test.ts) verifies
install-vs-detect isolation and home overrides for the seven original agents (`claude-code`, `codex`, `cursor`,
`gemini-cli`, `grok`, `opencode`, `pi`); each provider package keeps its own `discovery.test.ts` beside `src/discovery.ts`.

Harness-written paths (`hooks/`, `skills/`, `plugins/`, `extensions/`, and shared settings such as `settings.json`,
`config.toml`, `hooks.json`, `opencode.json(c)`, and Cursor's `User/mcp.json`) are excluded from installation evidence
for the corresponding agents; see each provider's `src/install.ts` for exact install targets.

Changing these facts affects consumers of `detectAgents` with the built-in recipes. Machines with no command,
recognized application, or agent-owned evidence path report `missing` (including Claude Code with only `~/.claude.json`
and machines populated only by hooks or shared settings), while Cursor desktop state still establishes `found` without
a CLI.
