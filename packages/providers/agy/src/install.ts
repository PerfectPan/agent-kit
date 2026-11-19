import { homeFromRule } from "@rivus/agent-kit-catalog/spi";
import {
  agentsOf,
  commandHook,
  jsonText,
  ownerSlug,
  type BundleRef,
  type HookRegistration,
  type InstallAdapter,
  type InstallContext,
  type JsonValue
} from "@rivus/agent-kit-harness/spi";
import {
  AGY_CONFIG_DIR,
  AGY_HOME,
  AGY_HOOKS_FILE,
  AGY_ID,
  AGY_PLUGIN_MANIFEST,
  AGY_PLUGINS_DIR,
  AGY_SKILLS_DIR
} from "./facts.js";

// Antigravity CLI discovers global customizations under `~/.gemini/config/` (relocated by `ANTIGRAVITY_GEMINI_DIR`):
// native plugins live at `plugins/<name>/` with `plugin.json` and root-level `hooks.json`, and skills live at
// `skills/<name>/SKILL.md`. `PreToolUse` and `PostToolUse` require grouped `{ matcher, hooks }` wrappers while the
// other four lifecycle events take flat handler lists directly.

const GROUPED_EVENTS = new Set(["PreToolUse", "PostToolUse"]);

function agyHome(context: InstallContext): string {
  return homeFromRule(AGY_ID, AGY_HOME, context).path;
}

function agyConfigDir(context: InstallContext): string {
  return `${agyHome(context)}/${AGY_CONFIG_DIR}`;
}

function agyPluginDir(context: InstallContext, bundle: BundleRef): string {
  return `${agyConfigDir(context)}/${AGY_PLUGINS_DIR}/${ownerSlug(bundle.owner)}`;
}

function agyHooksFile(owner: string, registrations: readonly HookRegistration[]): JsonValue {
  const byEvent = new Map<string, JsonValue[]>();
  for (const registration of registrations) {
    const list = byEvent.get(registration.event) ?? [];
    list.push(commandHook(registration));
    byEvent.set(registration.event, list);
  }
  const spec: Record<string, JsonValue> = {};
  for (const [event, handlers] of byEvent) {
    spec[event] = GROUPED_EVENTS.has(event) ? [{ matcher: "*", hooks: handlers }] : handlers;
  }
  return { [owner]: spec };
}

export const agyInstallAdapter: InstallAdapter = {
  specificationVersion: "harness-v1",
  agent: AGY_ID,
  hookStrategies: ["native-plugin"],
  skillStrategies: ["scan-directory"],
  roots: (context) => [agyHome(context)],
  hookFile: (_strategy, bundle) => `${agyPluginDir({ home: "~", env: {} }, bundle)}/${AGY_HOOKS_FILE}`,
  renderHooks: (strategy, registrations, bundle, context) =>
    registrations.length === 0
      ? []
      : [
          {
            locator: { kind: "dir", path: agyPluginDir(context, bundle) },
            content: {
              [AGY_PLUGIN_MANIFEST]: jsonText({ name: ownerSlug(bundle.owner) }),
              [AGY_HOOKS_FILE]: jsonText(agyHooksFile(ownerSlug(bundle.owner), registrations))
            },
            strategy,
            agents: agentsOf(registrations)
          }
        ],
  hookSources: (context) => [
    { path: `${agyConfigDir(context)}/${AGY_HOOKS_FILE}`, format: "json", layout: "named-hooks" },
    { path: `${agyConfigDir(context)}/${AGY_PLUGINS_DIR}/*/${AGY_HOOKS_FILE}`, format: "json", layout: "named-hooks" }
  ],
  renderSkill: (strategy, skill, context) => [
    {
      locator: { kind: "dir", path: `${agyConfigDir(context)}/${AGY_SKILLS_DIR}/${skill.name}` },
      content: skill.files,
      strategy
    }
  ]
};
