import type { CodingAgentId, HomeRule } from "@rivus/agent-kit-catalog";

import type { AuthReading } from "./auth-state.js";
import type { CommandOutput, Version } from "./version.js";

/**
 * A path a probe checks: `~` or `~/…` under the user's home directory, an absolute path, or `path` (`/`-separated,
 * relative) under the AgentHome of `agentHome`, which follows that agent's override variable.
 */
export type ProbePath = string | { readonly agentHome: CodingAgentId; readonly path?: string };

/** What kind of product the agent is; only its own probes decide whether it is runnable. */
export type InstallationKind = "cli" | "app" | "extension";

/**
 * A command run without a shell; `args` are fixed. Its parser must accept any output without throwing. It runs
 * unless the caller turns version probes off; `sideEffects` says what running it is known to do besides answering.
 */
export interface VersionProbe {
  readonly args: readonly string[];
  readonly parse: (output: CommandOutput) => Version | undefined;
  readonly sideEffects: readonly string[];
}

/**
 * The agent's own login status command. It runs only when the caller opts in (`authProbe: "commands"`), because
 * running an agent can change files or call its servers; `sideEffects` says how, as far as upstream sources show.
 */
export interface AuthCommandProbe {
  /** An executable from the recipe's `commands` to run instead of the agent's command, such as a CLI next to an app. */
  readonly command?: string;
  readonly args: readonly string[];
  /** Returns `undefined` for output it does not recognize; must not throw. */
  readonly parse: (output: CommandOutput) => AuthReading | undefined;
  readonly sideEffects: readonly string[];
}

/** A file where the agent stores credentials. */
export interface CredentialFileProbe {
  readonly path: ProbePath;
  /**
   * Reads the parsed JSON content and returns only non-secret facts, such as whether any credential is stored.
   * Without it, the file's existence counts as logged in and the file is never read. Must not throw.
   */
  readonly parse?: (json: unknown) => AuthReading | undefined;
}

/** An environment variable whose non-blank value authenticates the agent, and the login method it stands for. */
export interface AuthVariable {
  readonly name: string;
  readonly method?: string;
}

/** How to tell whether the agent is logged in. Nothing here may start a login. */
export interface AuthProbe {
  readonly command?: AuthCommandProbe;
  readonly credentialFiles?: readonly CredentialFileProbe[];
  readonly env?: readonly AuthVariable[];
}

/**
 * How discovery detects one agent. A recipe is data plus pure parsers; `detectAgents` does the IO. Built-in recipes
 * are in `builtinProbeRecipes`; a caller passes its own through the `recipes` option, and `/testing` has the
 * conformance checks a recipe must pass.
 */
export interface ProbeRecipe {
  readonly specificationVersion: "discovery-v1";
  readonly agent: CodingAgentId;
  /** For a built-in agent, the display name catalog gives it. */
  readonly displayName: string;
  readonly kind: InstallationKind;
  /** Executable names looked up on `PATH`, in order; the first found is the agent's command. */
  readonly commands: readonly string[];
  /** Application paths; the first that exists is the agent's application. */
  readonly appPaths: readonly ProbePath[];
  /**
   * macOS bundle ids the application must carry, for an app name another product shares. A bundle whose
   * `Contents/Info.plist` is XML and names another id does not count; one whose id cannot be read counts by its path.
   */
  readonly appBundleIds?: readonly string[];
  readonly configPaths: readonly ProbePath[];
  readonly mcpConfigPaths: readonly ProbePath[];
  /** Without a version probe, the agent is at most `found`. */
  readonly version?: VersionProbe;
  readonly auth?: AuthProbe;
  /** Caveats about the recipe's facts, such as which of them upstream sources do not confirm. */
  readonly warnings: readonly string[];
  /** The home rule of an agent that catalog does not know, for paths under its own AgentHome. */
  readonly home?: HomeRule;
}

/** Probe recipes by agent id; `detectAgents` defaults to `builtinProbeRecipes`. */
export type ProbeRecipes = Readonly<Partial<Record<CodingAgentId, ProbeRecipe>>>;

/** Credential files and variables an auth probe walks. Absent auth, and absent lists, are empty. */
export function authProbeLists(auth: AuthProbe | undefined): {
  readonly credentialFiles: readonly CredentialFileProbe[];
  readonly env: readonly AuthVariable[];
} {
  return {
    credentialFiles: auth?.credentialFiles ?? [],
    env: auth?.env ?? []
  };
}
