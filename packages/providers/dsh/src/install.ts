import { type InstallAdapter, renderSharedSkill, sharedAgentsDir } from "@rivus/agent-kit-harness/spi";

import { DSH_ID } from "./facts.js";

/**
 * DeepSeek Harness's local skill provider (`dsh-skill-filesystem`) scans `<dshHome>/skills` and `~/.agents/skills`
 * (`user-agents`, rank 500) for `<name>/SKILL.md` bundles. Shipped profiles have no default command-hook config
 * (command hooks require explicitly mounting an experimental bridge plugin), so `hookStrategies` is empty.
 */
export const dshInstallAdapter: InstallAdapter = {
  specificationVersion: "harness-v1",
  agent: DSH_ID,
  hookStrategies: [],
  skillStrategies: ["scan-directory"],
  roots: (context) => [sharedAgentsDir(context)],
  hookFile: () => "",
  renderHooks: () => [],
  renderSkill: (strategy, skill, context) => renderSharedSkill(strategy, skill, context),
  hookSources: () => []
};
