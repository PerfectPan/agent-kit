import type { CodingAgentId } from "@rivus/agent-kit-catalog";

import type { HookDialects } from "../value-objects/hook-dialect.js";
import type { TerminalIdentity } from "../value-objects/lifecycle-event.js";
import { type Env, isRecord, ownValue } from "./payload-fields.js";

const present = (value: unknown): boolean => typeof value === "string" && value !== "";

/** Agents that run other agents' hooks, with the payload key and the variable that give them away. */
const HOSTS: readonly { readonly agent: CodingAgentId; readonly payloadKey: string; readonly variable: string }[] = [
  { agent: "grok", payloadKey: "hookEventName", variable: "GROK_SESSION_ID" },
  { agent: "cursor", payloadKey: "cursor_version", variable: "CURSOR_VERSION" }
];

/**
 * The agent that really ran the hook. Grok and Cursor also run the hooks in Claude Code's settings, so a hook
 * registered for Claude Code can be called by either. Payload evidence wins: Grok's payloads carry `hookEventName`,
 * Cursor's `cursor_version`. The environment is inherited (Grok sets `GROK_SESSION_ID` for every MCP server it
 * starts, so an agent launched from there has it too), so `GROK_SESSION_ID` or `CURSOR_VERSION` only counts when the
 * declared agent is one whose hooks that host runs (its dialect's `runsHooksOf`).
 */
export function sniffSource(
  declared: CodingAgentId,
  payload: unknown,
  env: Env,
  dialects: HookDialects
): CodingAgentId {
  for (const host of HOSTS) {
    if (isRecord(payload) && present(ownValue(payload, host.payloadKey))) {
      return host.agent;
    }
  }
  for (const host of HOSTS) {
    const runsDeclared =
      Object.hasOwn(dialects, host.agent) &&
      dialects[host.agent]?.runsHooksOf?.some((foreign) => foreign.agent === declared) === true;
    if (runsDeclared && present(Object.hasOwn(env, host.variable) ? env[host.variable] : undefined)) {
      return host.agent;
    }
  }
  return declared;
}

/**
 * Pane variables of terminal hosts that track agents, most specific first: a host can run inside tmux, so tmux's
 * own pane is the fallback. Sources: herdr `src/pane.rs` (github.com/herdrdev/herdr); cmux
 * `TerminalSurface+StartupEnvironment.swift` (github.com/manaflow-ai/cmux, `CMUX_PANEL_ID` is an alias); Superset
 * `packages/host-service/src/terminal/env.ts` (`SUPERSET_TERMINAL_ID`) and the older desktop terminal's
 * `SUPERSET_PANE_ID` (github.com/superset-sh/superset); tmux(1) for `TMUX_PANE`.
 */
const TERMINAL_VARIABLES: readonly (readonly [TerminalIdentity["host"], string])[] = [
  ["herdr", "HERDR_PANE_ID"],
  ["cmux", "CMUX_SURFACE_ID"],
  ["cmux", "CMUX_PANEL_ID"],
  ["superset", "SUPERSET_TERMINAL_ID"],
  ["superset", "SUPERSET_PANE_ID"],
  ["tmux", "TMUX_PANE"]
];

/** The terminal pane the hook process runs in, from the variables its terminal host exports. */
export function terminalIdentity(env: Env): TerminalIdentity | undefined {
  for (const [host, name] of TERMINAL_VARIABLES) {
    const paneId = Object.hasOwn(env, name) ? env[name] : undefined;
    if (paneId !== undefined && paneId !== "") {
      return { host, paneId };
    }
  }
  return undefined;
}
