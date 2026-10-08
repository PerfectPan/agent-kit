import { type CodingAgentId, homeFromRule, type HomeRule, homeRuleOf } from "@rivus/agent-kit-catalog";
import type { FileStat } from "@rivus/agent-kit-platform";

import type { ProbePath, ProbeRecipe, StatFailed } from "../../domain/installation/index.js";
import { abortable, errnoCode } from "./abortable.js";
import { capabilityUnsupported } from "../errors.js";
import type { DiscoveryPlatform } from "../ports.js";

/** `undefined` when nothing is at the path; a `StatFailed` when it could not be checked. */
export type PathCheck = FileStat | StatFailed | undefined;

/**
 * Checks paths through `fs.stat`, following symlinks, once per path for one detection run. A file system error
 * (an errno `code`) becomes a `StatFailed`; anything else is a defect and rejects. An abort rejects with
 * `signal.reason`, even while a check hangs.
 */
export function createPathChecker(
  platform: DiscoveryPlatform,
  signal: AbortSignal | undefined
): (path: string) => Promise<PathCheck> {
  const checked = new Map<string, Promise<PathCheck>>();
  const check = async (path: string): Promise<PathCheck> => {
    try {
      return await platform.fs.stat(path, { followSymlinks: true });
    } catch (error) {
      const code = errnoCode(error);
      if (code === undefined) {
        throw error;
      }
      return { _tag: "StatFailed", path, code };
    }
  };
  return async (path) => {
    signal?.throwIfAborted();
    let pending = checked.get(path);
    if (pending === undefined) {
      pending = check(path);
      checked.set(path, pending);
    }
    return abortable(pending, signal);
  };
}

/** The variable's value; on Windows, where variable names ignore case, under any spelling such as `Path`. */
export function envValue(platform: Pick<DiscoveryPlatform, "env" | "os">, name: string): string | undefined {
  if (platform.os !== "win32") {
    return platform.env[name];
  }
  const upper = name.toUpperCase();
  const key = Object.keys(platform.env).find((candidate) => candidate.toUpperCase() === upper);
  return key === undefined ? undefined : platform.env[key];
}

/**
 * The home rule a recipe path under `agent`'s home follows: the recipe's own rule when it is for that same agent,
 * else the shared rule a path under another agent's home follows (catalog's for a built-in agent).
 */
function recipeHomeRule(agent: CodingAgentId, recipe: ProbeRecipe): HomeRule | undefined {
  return homeRuleOf(agent, agent === recipe.agent ? recipe.home : undefined);
}

/** Every path a recipe checks, including its credential files. */
export function recipePaths(recipe: ProbeRecipe): ProbePath[] {
  return [
    ...recipe.appPaths,
    ...recipe.configPaths,
    ...recipe.mcpConfigPaths,
    ...(recipe.auth?.credentialFiles ?? []).map((file) => file.path)
  ];
}

/** Throws `capability-unsupported` when a recipe checks a path under the home of an agent without a home rule. */
export function assertRecipePaths(recipe: ProbeRecipe): void {
  for (const path of recipePaths(recipe)) {
    if (typeof path !== "string" && recipeHomeRule(path.agentHome, recipe) === undefined) {
      throw capabilityUnsupported(path.agentHome, "has no home rule, but a probe recipe checks a path under its home");
    }
  }
}

/** Expands a recipe path against the user's home directory or an agent's home rule. */
export function expandProbePath(
  path: ProbePath,
  platform: Pick<DiscoveryPlatform, "env" | "home">,
  recipe: ProbeRecipe
): string {
  if (typeof path === "string") {
    if (path === "~") {
      return platform.home;
    }
    return path.startsWith("~/") ? `${platform.home.replace(/[/\\]+$/, "")}${path.slice(1)}` : path;
  }
  const rule = recipeHomeRule(path.agentHome, recipe);
  if (rule === undefined) {
    throw capabilityUnsupported(path.agentHome, "has no home rule, but a probe recipe checks a path under its home");
  }
  const home = homeFromRule(path.agentHome, rule, platform).path;
  return path.path === undefined ? home : `${home.replace(/[/\\]+$/, "")}/${path.path}`;
}

const WINDOWS_EXTENSIONS = ".COM;.EXE;.BAT;.CMD";

/**
 * Looks `command` up in the directories of `PATH`, in order, without running a shell. On Windows the names are tried
 * with each `PATHEXT` extension unless the command already has one, and quotes around an entry are dropped. Only
 * absolute directories are searched: an empty or relative entry would resolve against the caller's working
 * directory, and detection runs what it finds. Platform's `stat` reports no permission bits, so the first regular
 * file wins even when it is not executable; running it then fails with a `start-failed` problem (`EACCES`), where a
 * shell would have gone on to a later entry. A candidate that cannot be checked is returned as a problem, so that the
 * agent is not reported `missing` on a check that did not complete.
 */
export async function findCommand(
  platform: Pick<DiscoveryPlatform, "env" | "os">,
  check: (path: string) => Promise<PathCheck>,
  command: string
): Promise<{ readonly path?: string; readonly problems: readonly StatFailed[] }> {
  const windows = platform.os === "win32";
  const extensions = windows ? (envValue(platform, "PATHEXT") || WINDOWS_EXTENSIONS).split(";").filter(Boolean) : [""];
  const lower = command.toLowerCase();
  const names = extensions.some((extension) => lower.endsWith(extension.toLowerCase()))
    ? [command]
    : extensions.map((extension) => `${command}${extension}`);
  const absolute = windows ? /^(?:[A-Za-z]:[\\/]|[\\/]{2})/ : /^\//;
  const dirs = (envValue(platform, "PATH") ?? "")
    .split(windows ? ";" : ":")
    .map((dir) => (windows ? dir.replaceAll('"', "") : dir))
    .filter((dir) => absolute.test(dir));
  const problems: StatFailed[] = [];
  for (const dir of dirs) {
    const separator = dir.includes("\\") ? "\\" : "/";
    for (const name of names) {
      const candidate = `${dir.replace(/[/\\]+$/, "")}${separator}${name}`;
      const found = await check(candidate);
      if (found !== undefined && "_tag" in found) {
        problems.push(found);
      } else if (found?.kind === "file") {
        return { path: candidate, problems };
      }
    }
  }
  return { problems };
}
