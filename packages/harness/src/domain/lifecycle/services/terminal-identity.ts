import type { TerminalIdentity } from "../value-objects/lifecycle-event.js";
import type { Env } from "./payload-fields.js";

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
