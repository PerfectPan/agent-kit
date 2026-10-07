import type { CodingAgentId } from "@rivus/agent-kit-catalog";

/**
 * Hooks that observe lifecycle events; they never decide a permission gate. Events are named per agent in that
 * agent's HookDialect, and `hookRegistrations` turns them into registrations in the agent's units.
 */
export interface HookSpec {
  readonly type: "hooks";
  /**
   * The command each hook runs. Agents that review hooks by content hash ask again whenever it changes, so it points
   * at a stable shim and carries no version.
   */
  readonly command: string;
  /** Native event names by agent, keys of that agent's `HookDialect.events`; an agent missing here gets no hooks. */
  readonly events: Readonly<Partial<Record<CodingAgentId, readonly string[]>>>;
  /** Unset leaves each agent's default. */
  readonly timeoutSeconds?: number;
}

export interface SkillSpec {
  readonly type: "skill";
  /** The skill's directory name: lowercase letters, digits and hyphens. */
  readonly name: string;
  /** File text by relative path, `/`-separated; includes `SKILL.md`. */
  readonly files: Readonly<Record<string, string>>;
}

export type McpServerSpec = { readonly type: "mcp-server"; readonly name: string } & (
  | {
      readonly transport: "stdio";
      readonly command: string;
      readonly args?: readonly string[];
      readonly env?: Readonly<Record<string, string>>;
    }
  | { readonly transport: "http"; readonly url: string; readonly headers?: Readonly<Record<string, string>> }
);

/** Text kept in a managed block of the agent's instructions file, such as `AGENTS.md`. */
export interface InstructionSpec {
  readonly type: "instructions";
  /** The block id: lowercase letters, digits and hyphens. */
  readonly id: string;
  readonly text: string;
}

/** One thing a Bundle wants installed, before a strategy renders it for an agent. */
export type ArtifactSpec = HookSpec | SkillSpec | McpServerSpec | InstructionSpec;
