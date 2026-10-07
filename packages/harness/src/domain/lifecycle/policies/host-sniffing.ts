import type { CodingAgentId } from "@rivus/agent-kit-catalog";

import type { TerminalIdentity } from "../value-objects/lifecycle-event.js";
import { type Env, isRecord, ownValue } from "./payload-fields.js";

const present = (value: unknown): boolean => typeof value === "string" && value !== "";

/**
 * The agent that really ran the hook. Grok and Cursor also run the hooks in Claude Code's settings, so a hook
 * registered for Claude Code can be called by either: Grok sets `GROK_SESSION_ID` and its payloads carry
 * `hookEventName`; Cursor sets `CURSOR_VERSION` and its payloads carry `cursor_version`.
 */
export function sniffSource(declared: CodingAgentId, payload: unknown, env: Env): CodingAgentId {
  const field = (key: string) => (isRecord(payload) ? ownValue(payload, key) : undefined);
  const variable = (name: string) => (Object.hasOwn(env, name) ? env[name] : undefined);
  if (present(variable("GROK_SESSION_ID")) || present(field("hookEventName"))) {
    return "grok";
  }
  if (present(field("cursor_version")) || present(variable("CURSOR_VERSION"))) {
    return "cursor";
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
