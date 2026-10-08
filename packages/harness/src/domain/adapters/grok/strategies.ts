import { type InstallAdapter, ownerSlug } from "../../bundle/index.js";
import { agentsOf, groupedHooksFile, jsonText, sharedSkillsDir } from "../install-files.js";
import { grokHome, grokHooksFile } from "./config-files.js";

/**
 * Hooks go into a file of the owner's own in `~/.grok/hooks`, which Grok scans; its plugins would need an entry in
 * `config.toml` to be enabled. When Claude Code's or Cursor's hooks land in a file Grok runs, `placeHooks` drops
 * Grok's own registration of those events, so that each fires once.
 */
export const grokInstallAdapter: InstallAdapter = {
  specificationVersion: "harness-v1",
  agent: "grok",
  hookStrategies: ["scan-directory"],
  skillStrategies: ["scan-directory"],
  roots: (context) => [grokHome(context), `${context.home}/.agents`],
  hookFile: (_strategy, bundle) => `~/.grok/hooks/${ownerSlug(bundle.owner)}.json`,
  renderHooks: (strategy, registrations, bundle, context) =>
    registrations.length === 0
      ? []
      : [
          {
            locator: { kind: "file", path: grokHooksFile(context, bundle) },
            content: jsonText(groupedHooksFile(registrations)),
            strategy,
            agents: agentsOf(registrations)
          }
        ],
  hookSources: (context) => [{ path: `${grokHome(context)}/hooks/*.json`, format: "json", layout: "grouped" }],
  renderSkill: (strategy, skill, context) => [
    { locator: { kind: "dir", path: `${sharedSkillsDir(context)}/${skill.name}` }, content: skill.files, strategy }
  ]
};
