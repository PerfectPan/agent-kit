import type { CodingAgentId } from "./coding-agent-id.js";

/** The environment variables and the user's home directory that home rules read; a `Platform` satisfies it. */
export interface HomeContext {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly home: string;
}

/**
 * Where a CodingAgent keeps its configuration and data. An override variable either names the agent home itself
 * (`CODEX_HOME`), or a base directory under which the agent appends its own path (`XDG_DATA_HOME` plus
 * `opencode`); `envSubpath` holds that appended path.
 */
export interface HomeRule {
  readonly envVar?: string;
  readonly envSubpath?: readonly string[];
  /** The agent expands a leading `~` in the variable to the user's home directory. */
  readonly expandsTilde?: boolean;
  /** Path segments under the user's home directory when the variable is unset or blank. */
  readonly defaultPath: readonly string[];
}

export type AgentHomeSource = { readonly kind: "env"; readonly variable: string } | { readonly kind: "default" };

/** The configuration and data root of one CodingAgent on this machine, and what set it. */
export interface AgentHome {
  readonly agent: CodingAgentId;
  readonly path: string;
  readonly source: AgentHomeSource;
}
