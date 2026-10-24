/**
 * Id, aliases and home override from the Agents table in packages/agent-kit/README.md.
 * Capability flags are not stored here; the support table reads them from the provider objects.
 */
export interface AgentIdentity {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly home: { readonly en: string; readonly zh: string };
}

export const AGENT_IDENTITY: readonly AgentIdentity[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    aliases: ["claude"],
    home: { en: "CLAUDE_CONFIG_DIR, ~/.claude", zh: "CLAUDE_CONFIG_DIR，~/.claude" }
  },
  {
    id: "codex",
    name: "Codex",
    aliases: [],
    home: {
      en: "CODEX_HOME, ~/.codex (archived sessions included)",
      zh: "CODEX_HOME，~/.codex（包含已归档会话）"
    }
  },
  {
    id: "cursor",
    name: "Cursor",
    aliases: ["cursor-agent"],
    home: {
      en: "none: CURSOR_CONFIG_DIR, $XDG_CONFIG_HOME/cursor, ~/.cursor",
      zh: "无：CURSOR_CONFIG_DIR，$XDG_CONFIG_HOME/cursor，~/.cursor"
    }
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    aliases: ["gemini"],
    home: {
      en: "GEMINI_CLI_HOME replaces the user's home, ~/.gemini",
      zh: "GEMINI_CLI_HOME 替换用户主目录，~/.gemini"
    }
  },
  {
    id: "grok",
    name: "Grok",
    aliases: [],
    home: { en: "GROK_HOME, ~/.grok", zh: "GROK_HOME，~/.grok" }
  },
  {
    id: "opencode",
    name: "opencode",
    aliases: [],
    home: {
      en: "$XDG_DATA_HOME/opencode, ~/.local/share/opencode",
      zh: "$XDG_DATA_HOME/opencode，~/.local/share/opencode"
    }
  },
  {
    id: "pi",
    name: "Pi",
    aliases: [],
    home: {
      en: "PI_CODING_AGENT_DIR (expands ~), ~/.pi/agent",
      zh: "PI_CODING_AGENT_DIR（展开 ~），~/.pi/agent"
    }
  }
];
