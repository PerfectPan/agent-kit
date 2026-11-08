import {
  type BundleRef,
  type InstallAdapter,
  type InstallContext,
  type JsonValue,
  agentsOf,
  jsonText,
  ownerSlug,
  sharedAgentsDir,
  sharedSkillsDir
} from "@rivus/agent-kit-harness/spi";
import {
  HOME_DIR,
  ZCODE_CONFIG_FILE,
  ZCODE_ID,
  ZCODE_KIT_PLUGINS,
  ZCODE_PLUGIN_DIRS_POINTER,
  ZCODE_PLUGIN_HOOKS,
  ZCODE_PLUGIN_MANIFEST
} from "./facts.js";

// ZCode 3.17.2 enables plugins.dirs entries by default and reads grouped plugin hooks with timeoutMs in milliseconds.
// Its config loader locates the user config independently of ZCODE_STORAGE_DIR.

function configFile(context: InstallContext): string {
  return `${context.home}/${HOME_DIR}/${ZCODE_CONFIG_FILE}`;
}

/** Kit owns this namespace; ZCode's cache maintenance must not remove these source plugins. */
function pluginsDir(context: InstallContext): string {
  return `${sharedAgentsDir(context)}/${ZCODE_KIT_PLUGINS}`;
}

function pluginName(owner: string): string {
  // Owner is already parsed by Bundle. A full-owner FNV-1a suffix distinguishes scoped slug collisions and long
  // names with the same prefix. The available sessions SPI shortHash outputs base64url, whose uppercase letters
  // violate ZCode's lowercase-only name pattern. This non-security hash uses hex; the bounded prefix plus suffix
  // fits ZCode's 128-character manifest name and a directory segment.
  let hash = 0xcbf29ce484222325n;
  for (const char of owner) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(char.charCodeAt(0))) * 0x100000001b3n);
  }
  return `${ownerSlug(owner).slice(0, 111)}-${hash.toString(16).padStart(16, "0")}`;
}

function pluginDir(context: InstallContext, bundle: BundleRef): string {
  return `${pluginsDir(context)}/${pluginName(bundle.owner)}`;
}

export const zcodeInstallAdapter: InstallAdapter = {
  specificationVersion: "harness-v1",
  agent: ZCODE_ID,
  hookStrategies: ["native-plugin"],
  skillStrategies: ["scan-directory"],
  roots: (context) => [`${context.home}/${HOME_DIR}`, sharedAgentsDir(context)],
  hookFile: (_strategy, bundle) => `${pluginDir({ home: "~", env: {} }, bundle)}/${ZCODE_PLUGIN_HOOKS}`,
  renderHooks(strategy, registrations, bundle, context) {
    if (registrations.length === 0) {
      return [];
    }
    const dir = pluginDir(context, bundle);
    const hooks: Record<string, JsonValue[]> = {};
    for (const registration of registrations) {
      // commandHook/groupedHooksFile write timeout, which ZCode counts in seconds rather than the dialect's ms.
      const command = {
        type: "command",
        command: registration.command,
        ...(registration.timeout === undefined ? {} : { timeoutMs: Math.max(1, Math.round(registration.timeout)) })
      };
      hooks[registration.event] = [...(hooks[registration.event] ?? []), { hooks: [command] }];
    }
    const agents = agentsOf(registrations);
    return [
      {
        locator: { kind: "dir", path: dir },
        content: {
          [ZCODE_PLUGIN_MANIFEST]: jsonText({ name: pluginName(bundle.owner), version: bundle.version }),
          [ZCODE_PLUGIN_HOOKS]: jsonText({ hooks })
        },
        strategy,
        agents
      },
      {
        locator: {
          kind: "json-entry",
          path: configFile(context),
          pointer: ZCODE_PLUGIN_DIRS_POINTER,
          member: dir,
          memberIn: "element"
        },
        content: dir,
        strategy,
        agents
      }
    ];
  },
  renderSkill: (strategy, skill, context) => [
    { locator: { kind: "dir", path: `${sharedSkillsDir(context)}/${skill.name}` }, content: skill.files, strategy }
  ],
  // HookSource reads /hooks and cannot express the user config's /hooks/events or plugin enablement gates.
  hookSources: (context) => [
    { path: `${pluginsDir(context)}/*/${ZCODE_PLUGIN_HOOKS}`, format: "json", layout: "grouped" }
  ]
};
