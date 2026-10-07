import type { CodingAgentId } from "@rivus/agent-kit-catalog";

import type { HookDialects } from "../value-objects/hook-dialect.js";
import type { TerminalIdentity } from "../value-objects/lifecycle-event.js";
import { type Env, isRecord, ownValue } from "./payload-fields.js";

const present = (value: unknown): boolean => typeof value === "string" && value !== "";

/**
 * The agent that really ran the hook. Grok and Cursor also run the hooks in Claude Code's settings, so a hook
 * registered for Claude Code can be called by either. Payload evidence decides: every Grok payload carries
 * `hookEventName`, and Cursor's carry `cursor_version`. The environment is inherited (Grok sets `GROK_SESSION_ID` for
 * every MCP server it starts, so an agent launched from there has it too), so it never names Grok. `CURSOR_VERSION`
 * still names Cursor, because what Cursor sends to Claude Code's hooks is undocumented, but only when the declared
 * agent is one whose hooks Cursor runs (its dialect's `runsHooksOf`).
 */
export function sniffSource(
  declared: CodingAgentId,
  payload: unknown,
  env: Env,
  dialects: HookDialects
): CodingAgentId {
  const field = (key: string) => (isRecord(payload) ? ownValue(payload, key) : undefined);
  if (present(field("hookEventName"))) {
    return "grok";
  }
  if (present(field("cursor_version"))) {
    return "cursor";
  }
  const cursorRunsDeclared =
    Object.hasOwn(dialects, "cursor") &&
    dialects.cursor?.runsHooksOf?.some((foreign) => foreign.agent === declared) === true;
  if (cursorRunsDeclared && present(Object.hasOwn(env, "CURSOR_VERSION") ? env.CURSOR_VERSION : undefined)) {
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
