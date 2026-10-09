import { type InstallAdapter, ownerSlug } from "../../index.js";
import { agentsOf, sharedSkillsDir } from "../install-files.js";
import { piExtensionFile, piExtensionsDir, piHome } from "./config-files.js";

/** Events after which Pi may exit at once, so the bridge waits for the hook command (at most 5 s). */
const SYNC_EVENTS = ["session_shutdown"];

/**
 * The extension that forwards Pi's events to the hook command, in the payload shape the Pi HookDialect reads: the
 * event with its name as `type`, plus `sessionId` and `cwd` from the handler's context. The command runs through the
 * shell with the payload on stdin; a failure never reaches Pi.
 */
function bridgeSource(owner: string, command: string, events: readonly string[]): string {
  return `// Generated for ${owner} by @rivus/agent-kit: forwards Pi events to its hook command.
// Reinstalling overwrites this file; uninstalling removes it.
import { spawn, spawnSync } from "node:child_process"

const COMMAND = ${JSON.stringify(command)}
const EVENTS: string[] = ${JSON.stringify(events)}
const SYNC = new Set(${JSON.stringify(SYNC_EVENTS)})

function forward(type: string, payload: string): void {
  try {
    if (SYNC.has(type)) {
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
      forward(type, JSON.stringify({ ...event, type, sessionId, cwd: ctx?.cwd }))
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
              [...new Set(registrations.map(({ event }) => event))].toSorted()
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
    { kind: "files", dir: piExtensionsDir(context) },
    {
      kind: "entries",
      format: "json",
      path: `${piHome(context)}/settings.json`,
      pointer: "/extensions",
      memberIn: "element"
    }
  ]
};
