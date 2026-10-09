import { type HookRegistration, type InstallAdapter, ownerSlug } from "../../index.js";
import { agentsOf, sharedSkillsDir } from "../install-files.js";
import { aliasesOf, type HookDialect } from "../../../lifecycle/index.js";

import { opencodeHookDialect } from "../../../lifecycle/adapters/opencode.js";
import { opencodeConfigDir, opencodePluginFile, opencodePluginsDir } from "./config-files.js";

/** The registered events with every spelling the dialect accepts for them. */
export function bridgedEvents(dialect: HookDialect, registrations: readonly HookRegistration[]): readonly string[] {
  return [...new Set(registrations.flatMap(({ event }) => [event, ...aliasesOf(dialect.events, event)]))].toSorted();
}

/**
 * The plugin that forwards opencode's events to the hook command, in the payload shape the opencode HookDialect
 * reads: each bus event as it is, with the plugin input's `directory` added, and the inputs of the tool hooks as
 * `{ type, properties }`. The command runs through the shell with the payload on stdin; a failure never reaches
 * opencode.
 */
function bridgeSource(owner: string, command: string, events: readonly string[]): string {
  return `// Generated for ${owner} by @rivus/agent-kit: forwards opencode events to its hook command.
// Reinstalling overwrites this file; uninstalling removes it.
import { spawn } from "node:child_process"

const COMMAND = ${JSON.stringify(command)}
const EVENTS = new Set(${JSON.stringify(events)})

function forward(payload) {
  try {
    const child = spawn(COMMAND, { shell: true, stdio: ["pipe", "ignore", "ignore"] })
    child.on("error", () => {})
    child.stdin.on("error", () => {})
    child.stdin.end(JSON.stringify(payload))
  } catch {}
}

function forwardTool(type, input, directory) {
  if (EVENTS.has(type)) forward({ type, properties: input, directory })
}

export const AgentKitHooks = async ({ directory }) => ({
  event: async ({ event }) => {
    if (EVENTS.has(event?.type)) forward({ ...event, directory })
  },
  "tool.execute.before": async (input) => forwardTool("tool.execute.before", input, directory),
  "tool.execute.after": async (input) => forwardTool("tool.execute.after", input, directory)
})
`;
}

/** Hooks reach opencode through a bridge plugin in its plugins directory, which opencode loads without configuration. */
export const opencodeInstallAdapter: InstallAdapter = {
  specificationVersion: "harness-v1",
  agent: "opencode",
  hookStrategies: ["native-plugin"],
  skillStrategies: ["scan-directory"],
  roots: (context) => [opencodeConfigDir(context), `${context.home}/.agents`],
  hookFile: (_strategy, bundle) => `~/.config/opencode/plugins/${ownerSlug(bundle.owner)}.js`,
  renderHooks: (strategy, registrations, bundle, context) => {
    const [first] = registrations;
    return first === undefined
      ? []
      : [
          {
            locator: { kind: "file", path: opencodePluginFile(context, bundle) },
            content: bridgeSource(bundle.owner, first.command, bridgedEvents(opencodeHookDialect, registrations)),
            strategy,
            agents: agentsOf(registrations)
          }
        ];
  },
  renderSkill: (strategy, skill, context) => [
    { locator: { kind: "dir", path: `${sharedSkillsDir(context)}/${skill.name}` }, content: skill.files, strategy }
  ],
  legacySources: (context) => [
    { kind: "files", dir: opencodePluginsDir(context) },
    {
      kind: "entries",
      format: "json",
      path: `${opencodeConfigDir(context)}/opencode.json`,
      pointer: "/plugin",
      memberIn: "element"
    }
  ]
};
