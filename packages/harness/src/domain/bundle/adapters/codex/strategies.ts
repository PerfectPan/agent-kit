import { type CliRegistration, type InstallAdapter, type InstallContext, ownerSlug } from "../../index.js";
import type { ArtifactLocator } from "../../../install-plan/index.js";
import type { ArtifactContent } from "../../../ledger/index.js";
import { agentsOf, commandHook, groupedHooksFile, jsonText, sharedSkillsDir } from "../install-files.js";
import { codexConfigFile, codexHome, codexHooksFile, codexMarketplaceDir, codexPluginCache } from "./config-files.js";

const escapePointer = (key: string) => key.replaceAll("~", "~0").replaceAll("/", "~1");

/** The registrations `codex plugin` records in `config.toml`, by their JSON pointer there. */
function registrationPointers(name: string) {
  return {
    marketplace: `/marketplaces/${escapePointer(name)}`,
    plugin: `/plugins/${escapePointer(`${name}@${name}`)}`
  };
}

/**
 * The command lines behind Codex's two records in `config.toml`, what they leave on disk, and the copy Codex runs. A
 * plugin's registration reads as the hooks file in Codex's cache, so that changed hooks are added again.
 */
function cliRegistration(locator: ArtifactLocator, context: InstallContext): CliRegistration | undefined {
  if (locator.kind !== "cli-registration" || !/[\\/]config\.toml$/.test(locator.path)) {
    return undefined;
  }
  const record = (pointer: string): ArtifactLocator => ({
    kind: "toml-entry",
    path: codexConfigFile(context),
    pointer
  });
  const marketplace = /^\/marketplaces\/([^/]+)$/.exec(locator.pointer ?? "")?.[1];
  if (marketplace !== undefined) {
    const dir = `${codexHome(context)}/plugins/${marketplace}`;
    return {
      register: { command: "codex", args: ["plugin", "marketplace", "add", dir] },
      unregister: { command: "codex", args: ["plugin", "marketplace", "remove", marketplace] },
      recorded: { entries: [record(`/marketplaces/${marketplace}`)], copies: [] }
    };
  }
  const id = /^\/plugins\/([^/@]+)@([^/@]+)$/.exec(locator.pointer ?? "");
  if (id === null) {
    return undefined;
  }
  const [plugin = "", market = ""] = id.slice(1);
  const cache = codexPluginCache(context, plugin, market);
  return {
    register: { command: "codex", args: ["plugin", "add", `${plugin}@${market}`] },
    unregister: { command: "codex", args: ["plugin", "remove", `${plugin}@${market}`] },
    installedCopy: `${cache}/local/hooks/hooks.json`,
    recorded: { entries: [record(`/plugins/${plugin}@${market}`)], copies: [cache] }
  };
}

/**
 * Hooks go into a plugin in a marketplace of the owner's own, added with Codex's command line, so that the user's
 * `config.toml` keeps only the two records Codex writes itself; without the `codex` command they go into
 * `config.toml` as hook groups. Either way Codex asks the user to review each new or changed hook, by a hash of its
 * definition, so the command must stay stable across versions. Codex runs the copy `codex plugin add` puts in its
 * cache, not the marketplace directory: the plugin's registration reads as that copy, and changed hooks make the plan
 * add the plugin again. The plugin's files carry no version, so an upgrade with the same hooks changes nothing. Without
 * `codex`, an uninstall removes Codex's records and cached copy itself.
 */
export const codexInstallAdapter: InstallAdapter = {
  specificationVersion: "harness-v1",
  agent: "codex",
  hookStrategies: ["native-plugin", "shared-config"],
  skillStrategies: ["scan-directory"],
  requires: { "native-plugin": "codex" },
  roots: (context) => [codexHome(context), `${context.home}/.agents`],
  hookFile: (strategy, bundle) =>
    strategy === "native-plugin"
      ? `~/.codex/plugins/${ownerSlug(bundle.owner)}/plugins/${ownerSlug(bundle.owner)}/hooks/hooks.json`
      : "~/.codex/config.toml",
  renderHooks(strategy, registrations, bundle, context) {
    if (registrations.length === 0) {
      return [];
    }
    if (strategy === "native-plugin") {
      const name = ownerSlug(bundle.owner);
      const pointers = registrationPointers(name);
      const agents = agentsOf(registrations);
      const hooksFile = jsonText(groupedHooksFile(registrations));
      const registration = (pointer: string, content: ArtifactContent) =>
        ({
          locator: { kind: "cli-registration", path: codexConfigFile(context), pointer },
          content,
          strategy,
          agents
        }) as const;
      return [
        {
          locator: { kind: "dir", path: codexMarketplaceDir(context, bundle) },
          content: {
            ".agents/plugins/marketplace.json": jsonText({
              name,
              plugins: [
                {
                  name,
                  source: { source: "local", path: `./plugins/${name}` },
                  policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
                  category: "Productivity"
                }
              ]
            }),
            [`plugins/${name}/.codex-plugin/plugin.json`]: jsonText({
              name,
              description: `Hooks installed by ${bundle.owner}`
            }),
            [`plugins/${name}/hooks/hooks.json`]: hooksFile
          },
          strategy,
          trust: "hook-review",
          agents
        },
        registration(pointers.marketplace, true),
        // The plugin's registration is the hooks file Codex copied into its cache (see `cliRegistration`).
        registration(pointers.plugin, hooksFile)
      ];
    }
    return registrations.map((registration) => ({
      locator: {
        kind: "toml-entry",
        path: codexConfigFile(context),
        pointer: `/hooks/${registration.event}`,
        member: registration.command,
        memberIn: "hook-group"
      },
      content: commandHook(registration),
      strategy,
      trust: "hook-review",
      agents: registration.agents
    }));
  },
  renderSkill: (strategy, skill, context) => [
    { locator: { kind: "dir", path: `${sharedSkillsDir(context)}/${skill.name}` }, content: skill.files, strategy }
  ],
  hookSources: (context) => [
    { path: codexHooksFile(context), format: "json", layout: "grouped" },
    { path: codexConfigFile(context), format: "toml", layout: "grouped" },
    { path: `${codexHome(context)}/plugins/cache/*/*/local/hooks/hooks.json`, format: "json", layout: "grouped" }
  ],
  legacySources: (context) => [
    { kind: "entries", format: "json", path: codexHooksFile(context), pointer: "/hooks", memberIn: "hook-group" },
    { kind: "entries", format: "toml", path: codexConfigFile(context), pointer: "/hooks", memberIn: "hook-group" }
  ],
  cliRegistration
};
