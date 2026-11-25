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
import { COPILOT_HOME, COPILOT_HOOKS_DIR, COPILOT_HOOKS_SUFFIX, COPILOT_ID } from "./facts.js";

// GitHub Copilot CLI loads global hook files from `~/.copilot/hooks/*.json` (`{ version: 1, hooks: { ... } }`) and
// global skills from `~/.copilot/skills/<name>/SKILL.md`, all relocated together by `COPILOT_HOME`.

const COPILOT_SKILLS_DIR = "skills";

function copilotHome(context: InstallContext): string {
  return homeFromRule(COPILOT_ID, COPILOT_HOME, context).path;
}

function copilotHooksFilePath(context: InstallContext, bundle: BundleRef): string {
  return `${copilotHome(context)}/${COPILOT_HOOKS_DIR}/${ownerSlug(bundle.owner)}${COPILOT_HOOKS_SUFFIX}`;
}

function copilotHooksDocument(registrations: readonly HookRegistration[]): JsonValue {
  const hooks: Record<string, JsonValue[]> = {};
  for (const registration of registrations) {
    const list = hooks[registration.event] ?? [];
    list.push(commandHook(registration));
    hooks[registration.event] = list;
  }
  return { version: 1, hooks };
}

export const copilotInstallAdapter: InstallAdapter = {
  specificationVersion: "harness-v1",
  agent: COPILOT_ID,
  hookStrategies: ["scan-directory"],
  skillStrategies: ["scan-directory"],
  roots: (context) => [copilotHome(context)],
  hookFile: (_strategy, bundle) => copilotHooksFilePath({ home: "~", env: {} }, bundle),
  renderHooks(strategy, registrations, bundle, context) {
    if (registrations.length === 0) {
      return [];
    }
    return [
      {
        strategy,
        agents: agentsOf(registrations),
        locator: { kind: "file", path: copilotHooksFilePath(context, bundle) },
        content: jsonText(copilotHooksDocument(registrations))
      }
    ];
  },
  hookSources: (context) => [
    { path: `${copilotHome(context)}/${COPILOT_HOOKS_DIR}/*${COPILOT_HOOKS_SUFFIX}`, format: "json", layout: "flat" }
  ],
  renderSkill: (strategy, skill, context) => [
    {
      locator: { kind: "dir", path: `${copilotHome(context)}/${COPILOT_SKILLS_DIR}/${skill.name}` },
      content: skill.files,
      strategy
    }
  ]
};
