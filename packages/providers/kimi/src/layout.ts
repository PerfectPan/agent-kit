import type { AgentHome } from "@rivus/agent-kit-catalog/spi";
import { joinPath } from "@rivus/agent-kit-sessions/spi";
import { KIMI_SESSION_STATE_FILE, KIMI_SESSION_WIRE_FILE, KIMI_SESSIONS_DIR } from "./facts.js";

// Kimi Code keeps its sessions under `<home>/sessions/<workDirKey>/<sessionId>/`: `state.json` beside an `agents/`
// directory whose `main/wire.jsonl` is the main lane's event stream (subagents keep `agents/<id>/wire.jsonl`). The
// session id is the directory's name; the top-level `session_index.jsonl` repeats it with the session dir and the
// working directory.

export function kimiRoots(home: AgentHome): string[] {
  return [joinPath(home.path, KIMI_SESSIONS_DIR)];
}

/** The session directory a `wire.jsonl` path belongs to: two levels up. */
export function kimiSessionDir(wirePath: string): string {
  return joinPath(wirePath, "../..");
}

export function kimiStatePath(sessionDir: string): string {
  return joinPath(sessionDir, KIMI_SESSION_STATE_FILE);
}

/** The walk that finds main lanes; `agents/<subagent>/wire.jsonl` files are filtered by the preview. */
export const KIMI_SESSION_FILES = {
  match: (name: string): boolean => name === "wire.jsonl",
  maxDepth: 5
};

/** Whether a `wire.jsonl` under the root is a main lane's (`agents/main/`), not a subagent's. */
export function isMainLaneWire(path: string): boolean {
  return path.endsWith(`/agents/${"main"}/${KIMI_SESSION_WIRE_FILE.split("/").pop()}`);
}

/** What identifies a session file in a usage source id: the session id, which is its directory's name. */
export function kimiSessionIdOfWire(path: string): string | undefined {
  const parts = path.split("/").filter((part) => part !== "");
  return parts.at(-3);
}
