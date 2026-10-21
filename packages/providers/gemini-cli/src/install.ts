import { homeFromRule } from "@rivus/agent-kit-catalog/spi";
import {
  type BundleRef,
  type InstallContext,
  type InstallAdapter,
  ownerSlug,
  agentsOf,
  commandHook,
  groupedHooksFile,
  jsonText,
  sharedSkillsDir,
  sharedAgentsDir
} from "@rivus/agent-kit-harness/spi";
import {
  GEMINI_CLI_ID,
  GEMINI_CLI_HOME,
  GEMINI_CLI_SETTINGS_FILE,
  GEMINI_CLI_EXTENSIONS_DIR,
  GEMINI_CLI_EXTENSION_FILE,
  GEMINI_CLI_HOOKS_FILE,
  GEMINI_CLI_HOOKS_POINTER
} from "./facts.js";

// https://github.com/google-gemini/gemini-cli/blob/main/docs/extensions/reference.md (every directory under
// `~/.gemini/extensions` loads and is enabled unless `extension-enablement.json` says otherwise; `gemini-extension.json`
// needs `name` and `version`) and docs/hooks/reference.md (extension hooks in `hooks/hooks.json`, milliseconds),
// checked against packages/cli/src/config/extension-manager.ts at 249d51c.

/** Gemini CLI's home: `$GEMINI_CLI_HOME/.gemini`, or `~/.gemini`. */
function geminiHome(context: InstallContext): string {
  return homeFromRule(GEMINI_CLI_ID, GEMINI_CLI_HOME, context).path;
}

function geminiSettingsFile(context: InstallContext): string {
  return `${geminiHome(context)}/${GEMINI_CLI_SETTINGS_FILE}`;
}

function geminiExtensionDir(context: InstallContext, bundle: BundleRef): string {
  return `${geminiHome(context)}/${GEMINI_CLI_EXTENSIONS_DIR}/${ownerSlug(bundle.owner)}`;
}

/**
 * Hooks go into an extension, which is enabled once its directory exists and whose hooks still run in a folder the
 * user has not trusted; the settings file's hook groups are the fallback. Timeouts are in milliseconds, which
 * `hookRegistrations` already converted to.
 */
export const geminiCliInstallAdapter: InstallAdapter = {
  specificationVersion: "harness-v1",
  agent: GEMINI_CLI_ID,
  hookStrategies: ["native-plugin", "shared-config"],
  skillStrategies: ["scan-directory"],
  roots: (context) => [geminiHome(context), sharedAgentsDir(context)],
  hookFile: (strategy, bundle) =>
    strategy === "native-plugin"
      ? `${geminiExtensionDir({ home: "~", env: {} }, bundle)}/${GEMINI_CLI_HOOKS_FILE}`
      : geminiSettingsFile({ home: "~", env: {} }),
  renderHooks(strategy, registrations, bundle, context) {
    if (registrations.length === 0) {
      return [];
    }
    if (strategy === "native-plugin") {
      return [
        {
          locator: { kind: "dir", path: geminiExtensionDir(context, bundle) },
          content: {
            [GEMINI_CLI_EXTENSION_FILE]: jsonText({ name: ownerSlug(bundle.owner), version: bundle.version }),
            [GEMINI_CLI_HOOKS_FILE]: jsonText(groupedHooksFile(registrations))
          },
          strategy,
          agents: agentsOf(registrations)
        }
      ];
    }
    return registrations.map((registration) => ({
      locator: {
        kind: "json-entry",
        path: geminiSettingsFile(context),
        pointer: `${GEMINI_CLI_HOOKS_POINTER}/${registration.event}`,
        member: registration.command,
        memberIn: "hook-group"
      },
      content: commandHook(registration),
      strategy,
      agents: registration.agents
    }));
  },
  renderSkill: (strategy, skill, context) => [
    { locator: { kind: "dir", path: `${sharedSkillsDir(context)}/${skill.name}` }, content: skill.files, strategy }
  ],
  hookSources: (context) => [
    { path: geminiSettingsFile(context), format: "json", layout: "grouped" },
    {
      path: `${geminiHome(context)}/${GEMINI_CLI_EXTENSIONS_DIR}/*/${GEMINI_CLI_HOOKS_FILE}`,
      format: "json",
      layout: "grouped"
    }
  ],
  legacySources: (context) => [
    {
      kind: "entries",
      format: "json",
      path: geminiSettingsFile(context),
      pointer: GEMINI_CLI_HOOKS_POINTER,
      memberIn: "hook-group"
    }
  ]
};
