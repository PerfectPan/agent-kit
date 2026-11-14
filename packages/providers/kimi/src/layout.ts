import type { AgentHome } from "@rivus/agent-kit-catalog/spi";
import { joinPath } from "@rivus/agent-kit-sessions/spi";
import { KIMI_SESSIONS_DIR } from "./facts.js";

// Kimi Code keeps its sessions under `<home>/sessions/<workDirKey>/<sessionId>/`: `state.json` beside an `agents/`
// directory whose `main/wire.jsonl` is the main lane's event stream (subagents keep `agents/<id>/wire.jsonl`). The
// session id is the directory's name; the top-level `session_index.jsonl` repeats it with the session dir and the
// working directory.

export function kimiRoots(home: AgentHome): string[] {
  return [joinPath(home.path, KIMI_SESSIONS_DIR)];
}

/** The walk that finds main lanes; `agents/<subagent>/wire.jsonl` files are not sessions of their own. */
export const KIMI_SESSION_FILES = {
  match: (name: string): boolean => name === "wire.jsonl",
  maxDepth: 5
};
