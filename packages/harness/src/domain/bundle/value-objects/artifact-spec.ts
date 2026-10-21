import { err, ok, type Result } from "@rivus/agent-kit-catalog/public";
import type { InvalidBundle } from "./bundle.js";
import type { CodingAgentId } from "@rivus/agent-kit-catalog/public";

/**
 * Hooks that observe lifecycle events; they never decide a permission gate. Events are named per agent in that
 * agent's HookDialect, and `hookRegistrations` turns them into registrations in the agent's units.
 */
export interface HookSpec {
  readonly type: "hooks";
  /**
   * The command each hook runs; `{agent}` in it stands for the id of the agent a registration is for, so that the
   * hook process can name the declared agent to `readHookEvent`. Agents that review hooks by content hash ask again
   * whenever it changes, so it points at a stable shim and carries no version.
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
export type ArtifactSpecSnapshot = HookSpec | SkillSpec | McpServerSpec | InstructionSpec;

/** Deep-freeze helper: a spec retains no mutable descendants from its caller. */
function freeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) {
      freeze(inner);
    }
  }
  return value;
}

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Starts with a letter or `_`, so that as a JSON pointer segment it never reads as an array index (`0`, `-`). */
const MCP_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** A relative `/`-separated path that cannot leave its directory. */
const isRelativeFile = (path: string): boolean =>
  !path.includes("\\") && path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");

export class ArtifactSpec {
  readonly #snapshot: ArtifactSpecSnapshot;

  private constructor(snapshot: ArtifactSpecSnapshot) {
    this.#snapshot = freeze(structuredClone(snapshot));
    Object.freeze(this);
  }

  static restore(snapshot: ArtifactSpecSnapshot): Result<ArtifactSpec, InvalidBundle> {
    const reason = ArtifactSpec.problem(snapshot);
    return reason === undefined ? ok(new ArtifactSpec(snapshot)) : err({ _tag: "InvalidBundle", reason });
  }

  toSnapshot(): ArtifactSpecSnapshot {
    return this.#snapshot;
  }
  private static problem(artifact: ArtifactSpecSnapshot): string | undefined {
    switch (artifact.type) {
      case "hooks":
        if (artifact.command.trim() === "") {
          return "hook command is empty";
        }
        if (
          artifact.timeoutSeconds !== undefined &&
          !(Number.isFinite(artifact.timeoutSeconds) && artifact.timeoutSeconds > 0)
        ) {
          return "hook timeout is not a positive number of seconds";
        }
        return Object.values(artifact.events).some((events) => events?.some((event) => event === ""))
          ? "hook event name is empty"
          : undefined;
      case "skill":
        if (!NAME.test(artifact.name) || artifact.name.length > 64) {
          return `skill name "${artifact.name}" is not lowercase letters, digits and hyphens`;
        }
        if (!Object.hasOwn(artifact.files, "SKILL.md")) {
          return `skill "${artifact.name}" has no SKILL.md`;
        }
        return Object.keys(artifact.files).every(isRelativeFile)
          ? undefined
          : `skill "${artifact.name}" has a file path that leaves its directory`;
      case "mcp-server":
        return MCP_NAME.test(artifact.name)
          ? undefined
          : `MCP server name "${artifact.name}" does not start with a letter or "_" followed by letters, digits, "_" or "-"`;
      case "instructions":
        return NAME.test(artifact.id)
          ? undefined
          : `instructions id "${artifact.id}" is not lowercase letters, digits and hyphens`;
    }
  }
}
