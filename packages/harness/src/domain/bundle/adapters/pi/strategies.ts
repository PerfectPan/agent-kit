import { type InstallAdapter, ownerSlug } from "../../index.js";
import { agentsOf, sharedSkillsDir } from "../install-files.js";
import { finishSelectorsOf, type FinishSelector } from "../../../lifecycle/index.js";
import { piHookDialect } from "../../../lifecycle/adapters/pi.js";
import { piExtensionFile, piExtensionsDir, piHome } from "./config-files.js";

/**
 * The extension that forwards Pi's events to the hook command, in the payload shape the Pi HookDialect reads: the
 * event with its name as `type`, plus `sessionId` and `cwd` from the handler's context. The payloads `finish` marks
 * (the dialect's finish-phase events, a switch only for its finish field values) wait for the command to exit, at
 * most 5 s, so Pi cannot forward the next event before them; the command runs through the shell with the payload on
 * stdin, and a failure never reaches Pi. Exported for the bridge tests, which render sources with selector records
 * the built-in dialect has none of.
 */
export function bridgeSource(
  owner: string,
  command: string,
  events: readonly string[],
  finish: Readonly<Record<string, FinishSelector>>
): string {
  return `// Generated for ${owner} by @rivus/agent-kit: forwards Pi events to its hook command.
// Reinstalling overwrites this file; uninstalling removes it.
import { spawn, spawnSync } from "node:child_process"

const COMMAND = ${JSON.stringify(command)}
const EVENTS: string[] = ${JSON.stringify(events)}
const FINISH = ${JSON.stringify(finish)}

// A finish event waits for the command (at most 5 s), so Pi cannot forward the next event before it. A switch
// event is finish only for the field values its dialect maps to finish.
function isFinish(payload: any, type: string): boolean {
  const selector = Object.hasOwn(FINISH, type) ? FINISH[type] : undefined
  if (selector === undefined) return false
  if (selector === null) return true
  let value: any = payload
  for (const key of selector.path) value = value != null && Object.hasOwn(value, key) ? value[key] : undefined
  return selector.values.includes(value) || (selector.otherwise === true && !selector.others.includes(value))
}

function forward(type: string, payload: string, finish: boolean): void {
  try {
    if (finish) {
      spawnSync(COMMAND, { shell: true, input: payload, stdio: ["pipe", "ignore", "ignore"], timeout: 5000 })
      return
    }
    const child = spawn(COMMAND, { shell: true, stdio: ["pipe", "ignore", "ignore"] })
    child.on("error", () => {})
    child.stdin.on("error", () => {})
    child.stdin.end(payload)
  } catch {}
}

export default function (pi: any) {
  for (const type of EVENTS) {
    pi.on(type, async (event: any, ctx: any) => {
      let sessionId: string | undefined
      try {
        sessionId = ctx?.sessionManager?.getSessionId?.()
      } catch {}
      // The payload read, its stringify and the finish check share forward's fail-open boundary.
      try {
        const payload = { ...event, type, sessionId, cwd: ctx?.cwd }
        forward(type, JSON.stringify(payload), isFinish(payload, type))
      } catch {}
    })
  }
}
`;
}

/** Hooks reach Pi through a bridge extension in its extensions directory, which Pi loads without configuration. */
export const piInstallAdapter: InstallAdapter = {
  specificationVersion: "harness-v1",
  agent: "pi",
  hookStrategies: ["native-plugin"],
  skillStrategies: ["scan-directory"],
  roots: (context) => [piHome(context), `${context.home}/.agents`],
  hookFile: (_strategy, bundle) => `~/.pi/agent/extensions/${ownerSlug(bundle.owner)}.ts`,
  renderHooks: (strategy, registrations, bundle, context) => {
    const [first] = registrations;
    return first === undefined
      ? []
      : [
          {
            locator: { kind: "file", path: piExtensionFile(context, bundle) },
            content: bridgeSource(
              bundle.owner,
              first.command,
              [...new Set(registrations.map(({ event }) => event))].toSorted(),
              finishSelectorsOf(piHookDialect.events)
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
    { kind: "files", dir: piExtensionsDir(context), extensions: [".js", ".ts"] },
    {
      kind: "entries",
      format: "json",
      path: `${piHome(context)}/settings.json`,
      pointer: "/extensions",
      memberIn: "element"
    }
  ]
};
