import { type InstallAdapter, type InstallContext } from "@rivus/agent-kit-harness/spi";

import { AGENTS_HOME_ENV, DSH_ID } from "./facts.js";

function trimTrailingSeparators(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  return trimmed === "" || /^[A-Za-z]:$/.test(trimmed) ? path.slice(0, trimmed.length + 1) : trimmed;
}

function joinRoot(root: string, suffix: string): string {
  return /[/\\]$/.test(root) ? `${root}${suffix}` : `${root}/${suffix}`;
}

/**
 * DeepSeek Harness's shared agent root: `DSH_AGENTS_HOME`, or `~/.agents`. Matches upstream `resolveAgentsHome`:
 * whitespace-only values fall back to `~/.agents`, non-empty values keep their exact characters (including any
 * surrounding spaces), and `~` / `~/` / `~\` expand against `context.home`.
 */
function dshAgentsRoot(context: InstallContext): string {
  const raw = context.env[AGENTS_HOME_ENV];
  if (raw === undefined || raw.trim().length === 0) {
    return joinRoot(trimTrailingSeparators(context.home), ".agents");
  }
  const expanded =
    raw === "~"
      ? context.home
      : raw.startsWith("~/") || raw.startsWith("~\\")
        ? joinRoot(trimTrailingSeparators(context.home), raw.slice(2))
        : raw;
  return trimTrailingSeparators(expanded);
}

/**
 * DeepSeek Harness's local skill provider (`dsh-skill-filesystem`) scans `<dshHome>/skills` and
 * `<agentsHome>/skills` (`DSH_AGENTS_HOME` or `~/.agents`, `user-agents`, rank 500) for `<name>/SKILL.md`
 * bundles. Shipped profiles have no default command-hook config (command hooks require explicitly mounting
 * an experimental bridge plugin), so `hookStrategies` is empty.
 */
export const dshInstallAdapter: InstallAdapter = {
  specificationVersion: "harness-v1",
  agent: DSH_ID,
  hookStrategies: [],
  skillStrategies: ["scan-directory"],
  roots: (context) => [dshAgentsRoot(context)],
  hookFile: () => "",
  renderHooks: () => [],
  renderSkill: (strategy, skill, context) => [
    {
      locator: { kind: "dir", path: joinRoot(dshAgentsRoot(context), `skills/${skill.name}`) },
      content: skill.files,
      strategy
    }
  ],
  hookSources: () => []
};
