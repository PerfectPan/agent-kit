import { type CodingAgentId, parseCodingAgentId } from "@rivus/agent-kit-catalog";

import { builtinProbeRecipes } from "../../domain/installation/adapters/index.js";
import {
  type AuthObservation,
  type AuthState,
  classifyInstallation,
  envReading,
  type Evidence,
  installationWarnings,
  type Installation,
  type ProbeProblem,
  type ProbeRecipe,
  type ProbeRecipes,
  probesAuth,
  resolveAuthState,
  type Version
} from "../../domain/installation/index.js";
import { capabilityUnsupported } from "../errors.js";
import { mayBeBundle } from "../services/app-bundle.js";
import {
  assertRecipePaths,
  createPathChecker,
  envValue,
  expandProbePath,
  findCommand,
  type PathCheck
} from "../services/host-paths.js";
import type { DiscoveryPlatform } from "../ports.js";
import { readCredentialFile } from "../services/read-credential-file.js";
import { runProbe } from "../services/run-probe.js";

export interface DetectAgentsOptions {
  /** Agents to detect, by id or alias; defaults to every agent in `recipes`, in table order. */
  readonly agents?: readonly CodingAgentId[];
  /** Replaces `builtinProbeRecipes` for this call; spread it to extend it. */
  readonly recipes?: ProbeRecipes;
  readonly signal?: AbortSignal;
  /** Time limit of each probe command; defaults to 5 seconds. */
  readonly timeoutMs?: number;
  /**
   * Where login state comes from. `files` (the default) reads only credential files and environment variables, so
   * it works offline and changes nothing. `commands` also runs each agent's login status command, whose answer wins;
   * see each recipe's `auth.command.sideEffects` for what that can do.
   */
  readonly authProbe?: "files" | "commands";
  /**
   * Whether to run each agent's version probe; defaults to `true`. With `false` nothing is run (unless `authProbe`
   * is `commands`), so detection has no side effects, and no agent is `runnable`: at most `found`. See each recipe's
   * `version.sideEffects` for what a probe can do.
   */
  readonly versionProbe?: boolean;
}

const DEFAULT_TIMEOUT_MS = 5_000;

interface Run {
  readonly platform: DiscoveryPlatform;
  readonly check: (path: string) => Promise<PathCheck>;
  readonly timeoutMs: number;
  readonly signal: AbortSignal | undefined;
  readonly authProbe: "files" | "commands";
  readonly versionProbe: boolean;
}

/**
 * Detects each agent from its probe recipe: its command on `PATH`, its application, configuration and MCP paths,
 * its version (by running the version probe) and its login state (see `authProbe`). Agents are probed
 * concurrently; every probe command has a time limit and runs without a shell. A check that fails is reported in the installation's
 * `problems`, and detection goes on. Throws `capability-unsupported` when a requested agent has no recipe; an abort
 * rejects with `signal.reason` and stops the running commands.
 */
export async function detectAgents(
  platform: DiscoveryPlatform,
  options: DetectAgentsOptions = {}
): Promise<Installation[]> {
  const { signal } = options;
  signal?.throwIfAborted();
  const table: ProbeRecipes = options.recipes ?? builtinProbeRecipes;
  const recipes = selectRecipes(
    table,
    options.agents ?? Object.keys(table).filter((agent) => Object.hasOwn(table, agent) && table[agent] !== undefined)
  );
  const run: Run = {
    platform,
    check: createPathChecker(platform, signal),
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    signal,
    authProbe: options.authProbe ?? "files",
    versionProbe: options.versionProbe ?? true
  };
  const installations = await Promise.all(recipes.map((recipe) => detectOne(run, recipe)));
  signal?.throwIfAborted();
  return installations;
}

/** Picks the recipes and checks every path they name before anything runs. */
function selectRecipes(table: ProbeRecipes, agents: readonly CodingAgentId[]): ProbeRecipe[] {
  const selected = new Map<CodingAgentId, ProbeRecipe>();
  for (const requested of agents) {
    const parsed = parseCodingAgentId(requested);
    const agent = parsed.ok ? parsed.value : requested;
    const recipe = Object.hasOwn(table, agent) ? table[agent] : undefined;
    if (recipe === undefined) {
      throw capabilityUnsupported(agent);
    }
    assertRecipePaths(recipe);
    selected.set(agent, recipe);
  }
  return [...selected.values()];
}

async function detectOne(run: Run, recipe: ProbeRecipe): Promise<Installation> {
  const { platform, check } = run;
  const expand = (paths: ProbeRecipe["configPaths"]): string[] =>
    paths.map((path) => expandProbePath(path, platform, recipe));
  const [lookup, ...checked] = await Promise.all([
    firstCommand(run, recipe.commands),
    ...[recipe.appPaths, recipe.configPaths, recipe.mcpConfigPaths].map(async (paths) => {
      const expanded = expand(paths);
      return { paths: expanded, results: await Promise.all(expanded.map(check)) };
    })
  ]);
  // Problems are collected in probe order, not completion order, so that equal machines give equal reports.
  const { found: command } = lookup;
  const problems: ProbeProblem[] = [...lookup.problems];
  const [existingApps = [], configs = [], mcpConfigs = []] = checked.map(({ paths, results }) =>
    paths.filter((_, index) => {
      const result = results[index];
      if (result !== undefined && "_tag" in result) {
        problems.push(result);
        return false;
      }
      return result !== undefined;
    })
  );
  const { appBundleIds } = recipe;
  const apps =
    appBundleIds === undefined
      ? existingApps
      : await filterAsync(existingApps, (path) => mayBeBundle(platform, path, appBundleIds, run.signal));
  const appPath = apps[0];

  let version: Version | undefined;
  const probesVersion = command !== undefined && recipe.version !== undefined && run.versionProbe;
  if (command !== undefined && recipe.version && probesVersion) {
    const probed = await runProbe(platform, { purpose: "version", path: command.path, ...recipe.version }, run);
    if ("problem" in probed) {
      problems.push(probed.problem);
    } else {
      version = probed.value;
    }
  }

  const evidence: Evidence[] = [
    ...(command ? [{ kind: "command", ...command } as const] : []),
    ...(command && version && recipe.version
      ? [{ kind: "version", path: command.path, args: recipe.version.args, version } as const]
      : []),
    ...(appPath === undefined ? [] : [{ kind: "app", path: appPath } as const]),
    ...configs.map((path) => ({ kind: "config", path }) as const),
    ...mcpConfigs.map((path) => ({ kind: "mcp-config", path }) as const)
  ];
  const status = classifyInstallation(evidence, problems);
  const versionFailed = probesVersion && version === undefined;
  const auth = probesAuth(status)
    ? await detectAuth(run, recipe, versionFailed ? undefined : command?.path, problems)
    : ({ status: "unknown" } as const);

  return {
    agent: recipe.agent,
    displayName: recipe.displayName,
    kind: recipe.kind,
    status,
    ...(command ? { command: command.path } : {}),
    ...(appPath === undefined ? {} : { appPath }),
    ...(version ? { version } : {}),
    auth,
    evidence,
    problems,
    warnings: installationWarnings(recipe, problems)
  };
}

async function filterAsync(items: readonly string[], keep: (item: string) => Promise<boolean>): Promise<string[]> {
  const kept = await Promise.all(items.map(keep));
  return items.filter((_, index) => kept[index]);
}

async function firstCommand(
  run: Run,
  commands: readonly string[]
): Promise<{
  readonly found?: { readonly command: string; readonly path: string };
  readonly problems: readonly ProbeProblem[];
}> {
  const problems: ProbeProblem[] = [];
  for (const command of commands) {
    const lookup = await findCommand(run.platform, run.check, command);
    problems.push(...lookup.problems);
    if (lookup.path !== undefined) {
      return { found: { command, path: lookup.path }, problems };
    }
  }
  return { problems };
}

/**
 * `agentCommand` is the agent's command unless its version probe failed; a broken command is not asked for its login.
 * Observations are collected in a fixed order (command, credential files, variables), which `resolveAuthState` uses.
 */
async function detectAuth(
  run: Run,
  recipe: ProbeRecipe,
  agentCommand: string | undefined,
  problems: ProbeProblem[]
): Promise<AuthState> {
  const { auth } = recipe;
  if (auth === undefined) {
    return { status: "unknown" };
  }
  const { platform, check, signal } = run;
  const observations: AuthObservation[] = [];
  if (run.authProbe === "commands" && auth.command) {
    const named = auth.command.command;
    const path = named === undefined ? agentCommand : (await findCommand(platform, check, named)).path;
    if (path !== undefined) {
      const { args } = auth.command;
      const probed = await runProbe(platform, { purpose: "auth", path, ...auth.command }, run);
      if ("problem" in probed) {
        problems.push(probed.problem);
      } else {
        observations.push({ source: { kind: "command", command: path, args }, reading: probed.value });
      }
    }
  }
  for (const file of auth.credentialFiles ?? []) {
    const path = expandProbePath(file.path, platform, recipe);
    const found = await check(path);
    if (found !== undefined && "_tag" in found) {
      problems.push(found);
      continue;
    }
    if (found === undefined) {
      continue;
    }
    if (file.parse === undefined) {
      // A file the recipe does not parse: its existence is the observation, which `resolveAuthState` reads as logged in.
      observations.push({ source: { kind: "credential-file", path } });
      continue;
    }
    const read = await readCredentialFile(platform, path, file.parse, signal);
    if (read !== undefined && "problem" in read) {
      problems.push(read.problem);
    } else if (read !== undefined) {
      observations.push({ source: { kind: "credential-file", path }, reading: read.reading });
    }
  }
  for (const { name, method } of auth.env ?? []) {
    if (envValue(platform, name)?.trim()) {
      observations.push({ source: { kind: "env", variable: name }, reading: envReading(method) });
    }
  }
  return resolveAuthState(observations);
}
