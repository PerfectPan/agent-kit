import type { CodingAgentId } from "@rivus/agent-kit-catalog";

import type { ArtifactLocator } from "../../install-plan/value-objects/artifact-locator.js";
import type { TrustPromptKind } from "../../install-plan/value-objects/trust-prompt.js";
import type { ArtifactContent } from "../../ledger/value-objects/content-hash.js";
import type { PlacedRegistration } from "../services/hook-placement.js";
import type { SkillSpec } from "./artifact-spec.js";
import type { BundleRef } from "./bundle.js";
import type { Strategy } from "./strategy.js";

/** What an install adapter renders against: the user's home and environment, as the application's platform has them. */
export interface InstallContext {
  readonly home: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** One Artifact as an agent's strategy renders it, before its path is resolved and its content hashed. */
export interface RenderedArtifact {
  readonly locator: ArtifactLocator;
  readonly content: ArtifactContent;
  readonly strategy: Strategy;
  /** The confirmation the agent asks for when this content is new or changed. */
  readonly trust?: TrustPromptKind;
  /**
   * The agents that rely on this Artifact; the adapter's own agent when absent. A hook registration that other agents
   * run instead of their own lists them too (`PlacedRegistration.agents`).
   */
  readonly agents?: readonly CodingAgentId[];
}

/**
 * Where an older version of an owner may have left Artifacts without a ledger: a file, each regular file directly in
 * a directory, or the entries of a configuration file under `pointer` (each hook of the event lists under it for
 * `hook-group`, each element of the list at it for `element`).
 */
export type ArtifactSource =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "files"; readonly dir: string }
  | {
      readonly kind: "entries";
      readonly format: "json" | "toml";
      readonly path: string;
      readonly pointer: string;
      readonly memberIn: "element" | "hook-group";
    };

/** A file in which an agent loads command hooks, for `doctor`. */
export interface HookSource {
  /** Absolute; a `*` segment stands for every entry of its directory, such as each plugin's directory. */
  readonly path: string;
  readonly format: "json" | "toml";
  /**
   * `grouped`: `{ "hooks": { "<Event>": [{ "hooks": [{ "command" … }] }] } }`, as Claude Code writes them. `flat`:
   * `{ "hooks": { "<event>": [{ "command" … }] } }`, as Cursor does.
   */
  readonly layout: "grouped" | "flat";
}

/** An agent command line, run without a shell; `command` is looked up on `PATH`. */
export interface CommandLine {
  readonly command: string;
  readonly args: readonly string[];
}

/**
 * How a `cli-registration` Artifact is made and removed. Its locator's path is the file in which the agent's command
 * line records it and its pointer the JSON pointer of that record, so that reading the file tells whether it exists;
 * its content is `true` when active and `false` when its configuration explicitly disables it.
 */
export interface CliRegistration {
  readonly register: CommandLine;
  readonly unregister: CommandLine;
  /**
   * A file in which the agent keeps its own copy of what it registered, such as a plugin's hooks in Codex's plugin
   * cache. When set, an active registration's content is that file's text: a registration whose copy is outdated is
   * unregistered and registered again, and verify compares the copy the agent runs. A disabled registration stays
   * `false`, so a matching cached copy cannot hide the user's disabling it. This path and its parents are checked
   * for symlinks even before registration exists, and before each command-line mutation.
   */
  readonly installedCopy?: string;
  /**
   * The entries and copied directories affected by the command line. Declare all of them for its write guards;
   * symlinks at, above, or inside those directories block the command. Without the command on `PATH`, uninstall
   * removes these entries and directories itself. Include the registration's own entry at the command line's
   * declared config path: after resolving its specific agent home, that path must equal the planned locator's path.
   * Paths under an agent home resolve that home, never descendants.
   */
  readonly recorded?: { readonly entries: readonly ArtifactLocator[]; readonly copies: readonly string[] };
}

/**
 * How Artifacts reach one agent: which strategies it supports, in order of preference, and how each renders a
 * bundle. Pure: paths come from the context, and the application resolves them, reads what is there and plans.
 */
export interface InstallAdapter {
  readonly specificationVersion: "harness-v1";
  readonly agent: CodingAgentId;
  /** Strategies for hooks, most preferred first; absent when the agent takes no hooks. */
  readonly hookStrategies?: readonly Strategy[];
  /** Strategies for skills, most preferred first; absent when the agent reads no skills. */
  readonly skillStrategies?: readonly Strategy[];
  /** The executable a strategy needs on `PATH`; a strategy whose executable is missing is not chosen. */
  readonly requires?: Readonly<Partial<Record<Strategy, string>>>;
  /** The directories this adapter writes in, which every planned path must be inside. */
  roots(context: InstallContext): readonly string[];
  /**
   * The configuration file a hook strategy registers hooks in, written as in `ForeignHooks.files` (`~/` and a path
   * under the home), so that other agents that run that file are found.
   */
  hookFile(strategy: Strategy, bundle: BundleRef): string;
  /** The hook Artifacts for the registrations `placeHooks` kept for this agent; none for an empty list. */
  renderHooks(
    strategy: Strategy,
    registrations: readonly PlacedRegistration[],
    bundle: BundleRef,
    context: InstallContext
  ): readonly RenderedArtifact[];
  renderSkill(strategy: Strategy, skill: SkillSpec, context: InstallContext): readonly RenderedArtifact[];
  /** Every file this agent loads command hooks from, any owner's, so that `doctor` can find an event firing twice. */
  hookSources?(context: InstallContext): readonly HookSource[];
  /** Where older versions of an owner may have installed things for this agent without a ledger. */
  legacySources?(context: InstallContext): readonly ArtifactSource[];
  /** The command lines behind a `cli-registration` locator this adapter renders, `undefined` for any other. */
  cliRegistration?(locator: ArtifactLocator, context: InstallContext): CliRegistration | undefined;
}

/** Install adapters by agent id; the use cases default to `builtinInstallAdapters`. */
export type InstallAdapters = Readonly<Partial<Record<CodingAgentId, InstallAdapter>>>;

/**
 * The file and directory name for an owner's own Artifacts, such as its plugin directory: `@scope/app` becomes
 * `scope-app`.
 */
export function ownerSlug(owner: string): string {
  return owner.replace(/^@/, "").replaceAll("/", "-");
}
