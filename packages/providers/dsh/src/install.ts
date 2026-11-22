import { homeFromRule } from "@rivus/agent-kit-catalog/spi";
import { type InstallAdapter, type InstallContext } from "@rivus/agent-kit-harness/spi";

import { DSH_AGENTS_HOME, DSH_ID } from "./facts.js";

/** DeepSeek Harness's shared agent root: `DSH_AGENTS_HOME`, or `~/.agents`. */
function dshAgentsRoot(context: InstallContext): string {
  return homeFromRule(DSH_ID, DSH_AGENTS_HOME, context).path;
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
    { locator: { kind: "dir", path: `${dshAgentsRoot(context)}/skills/${skill.name}` }, content: skill.files, strategy }
  ],
  hookSources: () => []
};
