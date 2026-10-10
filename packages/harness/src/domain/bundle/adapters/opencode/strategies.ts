import { type HookRegistration, type InstallAdapter, ownerSlug } from "../../index.js";
import { agentsOf, sharedSkillsDir } from "../install-files.js";
import { aliasesOf, type HookDialect } from "../../../lifecycle/index.js";

import { opencodeCurrentSessionField, opencodeHookDialect } from "../../../lifecycle/adapters/opencode.js";
import { opencodeConfigDir, opencodePluginFile, opencodePluginsDir } from "./config-files.js";

/** The registered events with every spelling the dialect accepts for them. */
export function bridgedEvents(dialect: HookDialect, registrations: readonly HookRegistration[]): readonly string[] {
  return [...new Set(registrations.flatMap(({ event }) => [event, ...aliasesOf(dialect.events, event)]))].toSorted();
}

/**
 * Session paths opencode itself sends. The bridge remembers a session from these, not from the fallback field it
 * adds, so its own field cannot become the memory.
 */
function nativeSessionPaths(): readonly (readonly string[])[] {
  return (opencodeHookDialect.fields.sessionId?.paths ?? []).filter(
    (path) => path.length !== 1 || path[0] !== opencodeCurrentSessionField
  );
}

/**
 * The plugin that forwards opencode's events to the hook command, in the payload shape the opencode HookDialect
 * reads: each bus event as it is, with the plugin input's `directory` added, and the inputs of the tool hooks as
 * `{ type, properties }`. Every call is observed for a session id before the registration filter decides what to
 * forward, including a tool input the bridge does not send. An event that names no session also gets
 * `currentSessionId`, the latest session id this plugin instance (one directory) has seen. Reading that id, adding
 * the field, and starting the command share one try/catch, so a throw never rejects the callback into opencode. The
 * session walk is inlined because the plugin cannot import the kit.
 */
function bridgeSource(owner: string, command: string, events: readonly string[]): string {
  return `// Generated for ${owner} by @rivus/agent-kit: forwards opencode events to its hook command.
// Reinstalling overwrites this file; uninstalling removes it.
// An event that names no session gets currentSessionId, the latest session this instance has seen.
// Every call is observed before the registration filter. A throw while reading or sending stays here.
import { spawn } from "node:child_process"

const COMMAND = ${JSON.stringify(command)}
const EVENTS = new Set(${JSON.stringify(events)})
const SESSION_PATHS = ${JSON.stringify(nativeSessionPaths())}
const CURRENT_SESSION = ${JSON.stringify(opencodeCurrentSessionField)}

function namedSessionId(payload) {
  for (const path of SESSION_PATHS) {
    let value = payload
    for (const key of path) {
      if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) {
        value = undefined
        break
      }
      value = value[key]
    }
    if (typeof value === "string" && value !== "") return value
  }
  return undefined
}

function send(payload) {
  const child = spawn(COMMAND, { shell: true, stdio: ["pipe", "ignore", "ignore"] })
  child.on("error", () => {})
  child.stdin.on("error", () => {})
  child.stdin.end(JSON.stringify(payload))
}

export const AgentKitHooks = async ({ directory }) => {
  let currentSessionId
  // Remember first, then forward only a registered event. One try covers the walk, the added field, and send.
  function accept(payload, type) {
    const named = namedSessionId(payload)
    if (named !== undefined) currentSessionId = named
    if (!EVENTS.has(type)) return
    if (named === undefined && currentSessionId !== undefined) {
      payload = { ...payload, [CURRENT_SESSION]: currentSessionId }
    }
    send(payload)
  }
  return {
    event: async (input) => {
      try {
        const event = input !== null && typeof input === "object" ? input.event : undefined
        const record = event !== null && typeof event === "object" ? event : {}
        accept({ ...record, directory }, record.type)
      } catch {}
    },
    "tool.execute.before": async (input) => {
      try {
        accept({ type: "tool.execute.before", properties: input, directory }, "tool.execute.before")
      } catch {}
    },
    "tool.execute.after": async (input) => {
      try {
        accept({ type: "tool.execute.after", properties: input, directory }, "tool.execute.after")
      } catch {}
    }
  }
}
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
