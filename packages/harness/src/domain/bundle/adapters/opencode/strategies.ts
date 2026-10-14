import { type HookRegistration, type InstallAdapter, ownerSlug } from "../../index.js";
import { agentsOf, sharedSkillsDir } from "../install-files.js";
import {
  aliasesOf,
  finishSelectorsOf,
  type FieldPath,
  type FinishSelector,
  type HookDialect,
  type HookEventSpec
} from "../../../lifecycle/index.js";

import { opencodeCurrentSessionField, opencodeHookDialect } from "../../../lifecycle/adapters/opencode.js";
import { opencodeConfigDir, opencodePluginFile, opencodePluginsDir } from "./config-files.js";

/** The registered events with every spelling the dialect accepts for them. */
export function bridgedEvents(dialect: HookDialect, registrations: readonly HookRegistration[]): readonly string[] {
  return [...new Set(registrations.flatMap(({ event }) => [event, ...aliasesOf(dialect.events, event)]))].toSorted();
}

const spellings = (name: string): readonly string[] => [name, ...aliasesOf(opencodeHookDialect.events, name)];

/**
 * The paths the dialect reads an event's session id from, without the field the bridge adds: the bridge remembers
 * only an id the dialect would read as that event's own session, so neither another object's `id` nor its own field
 * becomes the memory.
 */
function namedSessionPaths(spec: HookEventSpec | undefined): readonly FieldPath[] {
  const source = spec?.fields?.sessionId ?? opencodeHookDialect.fields.sessionId;
  return (source?.paths ?? []).filter((path) => path.length !== 1 || path[0] !== opencodeCurrentSessionField);
}

/** Each spelling of an event whose session id paths replace the dialect's, with those paths. */
function eventSessionPaths(): Readonly<Record<string, readonly FieldPath[]>> {
  return Object.fromEntries(
    Object.entries(opencodeHookDialect.events).flatMap(([name, spec]) =>
      spec.fields?.sessionId === undefined
        ? []
        : spellings(name).map((event): [string, readonly FieldPath[]] => [event, namedSessionPaths(spec)])
    )
  );
}

/** Each spelling of an event that ends the session it names. */
function sessionEndEvents(): readonly string[] {
  return Object.entries(opencodeHookDialect.events).flatMap(([name, { lifecycle }]) =>
    // A switch picks its mapping per payload, so only a fixed mapping ends the session on every payload.
    !("cases" in lifecycle) && lifecycle.phase === "finish" && lifecycle.scope === "session" ? spellings(name) : []
  );
}

/**
 * The plugin that forwards opencode's events to the hook command, in the payload shape, `currentSessionId`
 * included, that the opencode HookDialect describes. Each callback runs inside one try/catch, so a payload that throws
 * while it is read, waited on or forwarded never rejects the callback into opencode. The plugin cannot import the
 * kit, so the path walk is inlined.
 */
function bridgeSource(
  owner: string,
  command: string,
  events: readonly string[],
  finish: Readonly<Record<string, FinishSelector>>
): string {
  return `// Generated for ${owner} by @rivus/agent-kit: forwards opencode events to its hook command.
// Reinstalling overwrites this file; uninstalling removes it.
import { spawn, spawnSync } from "node:child_process"

const COMMAND = ${JSON.stringify(command)}
const EVENTS = new Set(${JSON.stringify(events)})
const FINISH = ${JSON.stringify(finish)}
const SESSION_PATHS = ${JSON.stringify(namedSessionPaths(undefined))}
const EVENT_SESSION_PATHS = ${JSON.stringify(eventSessionPaths())}
const SESSION_ENDS = new Set(${JSON.stringify(sessionEndEvents())})
const CURRENT_SESSION = ${JSON.stringify(opencodeCurrentSessionField)}

function namedSessionId(payload, type) {
  const paths = Object.hasOwn(EVENT_SESSION_PATHS, type) ? EVENT_SESSION_PATHS[type] : SESSION_PATHS
  for (const path of paths) {
    let value = payload
    for (const key of path) value = value != null && Object.hasOwn(value, key) ? value[key] : undefined
    if (typeof value === "string" && value !== "") return value
  }
  return undefined
}

// A finish event waits for the command (at most 5 s), so opencode cannot forward the next event before it. A
// switch event is finish only for the field values its dialect maps to finish.
function isFinish(payload, type) {
  const selector = Object.hasOwn(FINISH, type) ? FINISH[type] : undefined
  if (selector === undefined) return false
  if (selector === null) return true
  let value = payload
  for (const key of selector.path) value = value != null && Object.hasOwn(value, key) ? value[key] : undefined
  return selector.values.includes(value) || (selector.otherwise === true && !selector.others.includes(value))
}

function send(payload, finish) {
  if (finish) {
    spawnSync(COMMAND, { shell: true, input: JSON.stringify(payload), stdio: ["pipe", "ignore", "ignore"], timeout: 5000 })
    return
  }
  const child = spawn(COMMAND, { shell: true, stdio: ["pipe", "ignore", "ignore"] })
  child.on("error", () => {})
  child.stdin.on("error", () => {})
  child.stdin.end(JSON.stringify(payload))
}

export const AgentKitHooks = async ({ directory }) => {
  let currentSessionId
  function accept(payload, type) {
    const named = namedSessionId(payload, type)
    if (SESSION_ENDS.has(type)) {
      if (named === currentSessionId) currentSessionId = undefined
    } else if (named !== undefined) {
      currentSessionId = named
    }
    if (!EVENTS.has(type)) return
    send(
      named === undefined && currentSessionId !== undefined ? { ...payload, [CURRENT_SESSION]: currentSessionId } : payload,
      isFinish(payload, type)
    )
  }
  return {
    event: async (input) => {
      try {
        const event = input?.event
        accept({ ...event, directory }, event?.type)
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
            content: bridgeSource(
              bundle.owner,
              first.command,
              bridgedEvents(opencodeHookDialect, registrations),
              finishSelectorsOf(opencodeHookDialect.events)
            ),
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
