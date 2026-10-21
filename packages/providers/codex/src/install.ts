import {
  CODEX_ID,
  CODEX_COMMAND,
  CODEX_HOME,
  CODEX_PLUGINS_DIR,
  CODEX_MARKETPLACE_MANIFEST,
  CODEX_CONFIG_FILE,
  CODEX_HOOKS_FILE,
  CODEX_PLUGIN_CACHE_DIR,
  CODEX_CONFIG_PATTERN,
  CODEX_PLUGIN_HOOKS,
  CODEX_HOME_DIR,
  CODEX_PLUGIN_MANIFEST,
  CODEX_HOOKS_POINTER,
  CODEX_HOOK_FORMAT,
  CODEX_HOOK_LAYOUT,
  CODEX_CONFIG_FORMAT
} from "./facts.js";
import { homeFromRule } from "@rivus/agent-kit-catalog/spi";
import {
  type BundleRef,
  type CliRegistration,
  type InstallAdapter,
  type InstallContext,
  ownerSlug,
  type ArtifactLocator,
  locatorPointer,
  type ArtifactContent,
  agentsOf,
  commandHook,
  groupedHooksFile,
  jsonText,
  sharedAgentsDir,
  sharedSkillsDir
} from "@rivus/agent-kit-harness/spi";

// https://developers.openai.com/codex/hooks (hooks in `config.toml` as `[[hooks.<Event>]]` groups with
// `[[hooks.<Event>.hooks]]` handlers, or in `hooks.json`; trust stored per hook by content hash) and
// https://developers.openai.com/plugins/build/plugins (marketplaces, `codex plugin add`). Checked against
// github.com/openai/codex at 3342ee8: plugins load only from the cache `codex plugin add` fills, which records
// `[plugins."<name>@<marketplace>"]` in `config.toml`; `codex plugin marketplace add <dir>` records
// `[marketplaces.<name>]`.

/** Codex's home: `CODEX_HOME`, or `~/.codex`. */
function codexHome(context: InstallContext): string {
  return homeFromRule(CODEX_ID, CODEX_HOME, context).path;
}

function codexConfigFile(context: InstallContext): string {
  return `${codexHome(context)}/${CODEX_CONFIG_FILE}`;
}

/** Where older versions of some applications registered hooks without a plugin. */
function codexHooksFile(context: InstallContext): string {
  return `${codexHome(context)}/${CODEX_HOOKS_FILE}`;
}

/**
 * Where `codex plugin add <plugin>@<marketplace>` copies a plugin from a local marketplace, which is what Codex
 * loads (checked with codex-cli 0.154.0).
 */
function codexPluginCache(context: InstallContext, plugin: string, marketplace: string): string {
  return `${codexHome(context)}/${CODEX_PLUGIN_CACHE_DIR}/${marketplace}/${plugin}`;
}

/**
 * The owner's own local marketplace: `.agents/plugins/marketplace.json` listing one plugin, the owner's, under
 * `plugins/<name>`. A marketplace of its own keeps the personal `~/.agents/plugins/marketplace.json` untouched.
 */
function codexMarketplaceDir(context: InstallContext, bundle: BundleRef): string {
  return `${codexHome(context)}/${CODEX_PLUGINS_DIR}/${ownerSlug(bundle.owner)}`;
}

const escapePointer = (key: string) => key.replaceAll("~", "~0").replaceAll("/", "~1");

/** The registrations `codex plugin` records in `config.toml`, by their JSON pointer there. */
function registrationPointers(name: string) {
  return {
    marketplace: `/marketplaces/${escapePointer(name)}`,
    plugin: `/${CODEX_PLUGINS_DIR}/${escapePointer(`${name}@${name}`)}`
  };
}

/**
 * The command lines behind Codex's two records in `config.toml`, what they leave on disk, and the copy Codex runs. A
 * plugin's registration reads as the hooks file in Codex's cache, so that changed hooks are added again.
 */
function cliRegistration(locator: ArtifactLocator, context: InstallContext): CliRegistration | undefined {
  if (locator.kind !== "cli-registration" || !CODEX_CONFIG_PATTERN.test(locator.path)) {
    return undefined;
  }
  const record = (pointer: string): ArtifactLocator => ({
    kind: "toml-entry",
    path: codexConfigFile(context),
    pointer
  });
  const pointer = locatorPointer(locator);
  const marketplace = /^\/marketplaces\/([^/]+)$/.exec(pointer)?.[1];
  if (marketplace !== undefined) {
    const dir = `${codexHome(context)}/${CODEX_PLUGINS_DIR}/${marketplace}`;
    return {
      register: { command: CODEX_COMMAND, args: ["plugin", "marketplace", "add", dir] },
      unregister: { command: CODEX_COMMAND, args: ["plugin", "marketplace", "remove", marketplace] },
      recorded: { entries: [record(`/marketplaces/${marketplace}`)], copies: [] }
    };
  }
  const id = /^\/plugins\/([^/@]+)@([^/@]+)$/.exec(pointer);
  if (id === null) {
    return undefined;
  }
  const [plugin = "", market = ""] = id.slice(1);
  const cache = codexPluginCache(context, plugin, market);
  return {
    register: { command: CODEX_COMMAND, args: ["plugin", "add", `${plugin}@${market}`] },
    unregister: { command: CODEX_COMMAND, args: ["plugin", "remove", `${plugin}@${market}`] },
    installedCopy: `${cache}/local/${CODEX_PLUGIN_HOOKS}`,
    recorded: { entries: [record(`/${CODEX_PLUGINS_DIR}/${plugin}@${market}`)], copies: [cache] }
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
  agent: CODEX_ID,
  hookStrategies: ["native-plugin", "shared-config"],
  skillStrategies: ["scan-directory"],
  requires: { "native-plugin": CODEX_COMMAND },
  roots: (context) => [codexHome(context), sharedAgentsDir(context)],
  hookFile: (strategy, bundle) =>
    strategy === "native-plugin"
      ? `~/${CODEX_HOME_DIR}/${CODEX_PLUGINS_DIR}/${ownerSlug(bundle.owner)}/${CODEX_PLUGINS_DIR}/${ownerSlug(bundle.owner)}/${CODEX_PLUGIN_HOOKS}`
      : `~/${CODEX_HOME_DIR}/${CODEX_CONFIG_FILE}`,
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
            [CODEX_MARKETPLACE_MANIFEST]: jsonText({
              name,
              plugins: [
                {
                  name,
                  source: { source: "local", path: `./${CODEX_PLUGINS_DIR}/${name}` },
                  policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
                  category: "Productivity"
                }
              ]
            }),
            [`${CODEX_PLUGINS_DIR}/${name}/${CODEX_PLUGIN_MANIFEST}`]: jsonText({
              name,
              description: `Hooks installed by ${bundle.owner}`
            }),
            [`${CODEX_PLUGINS_DIR}/${name}/${CODEX_PLUGIN_HOOKS}`]: hooksFile
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
        pointer: `${CODEX_HOOKS_POINTER}/${registration.event}`,
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
    { path: codexHooksFile(context), format: CODEX_HOOK_FORMAT, layout: CODEX_HOOK_LAYOUT },
    { path: codexConfigFile(context), format: CODEX_CONFIG_FORMAT, layout: CODEX_HOOK_LAYOUT },
    {
      path: `${codexHome(context)}/${CODEX_PLUGIN_CACHE_DIR}/*/*/local/${CODEX_PLUGIN_HOOKS}`,
      format: CODEX_HOOK_FORMAT,
      layout: CODEX_HOOK_LAYOUT
    }
  ],
  legacySources: (context) => [
    {
      kind: "entries",
      format: CODEX_HOOK_FORMAT,
      path: codexHooksFile(context),
      pointer: CODEX_HOOKS_POINTER,
      memberIn: "hook-group"
    },
    {
      kind: "entries",
      format: CODEX_CONFIG_FORMAT,
      path: codexConfigFile(context),
      pointer: CODEX_HOOKS_POINTER,
      memberIn: "hook-group"
    }
  ],
  cliRegistration
};
