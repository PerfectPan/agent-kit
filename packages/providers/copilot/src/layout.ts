import type { AgentHome } from "@rivus/agent-kit-catalog/spi";
import { joinPath } from "@rivus/agent-kit-sessions/spi";
import { COPILOT_EVENTS_FILE, COPILOT_SESSION_STATE_DIR } from "./facts.js";

// Each session is a directory under `<home>/session-state/`: `events.jsonl` holds its records, beside
// `workspace.yaml`, `plan.md`, `session.db` and `checkpoints/`. The directory's name is the session id, which the
// `session.start` record repeats.

export function copilotRoots(home: AgentHome): string[] {
  return [joinPath(home.path, COPILOT_SESSION_STATE_DIR)];
}

const COPILOT_JOURNAL_FILE = /^events(?:\.\d+)?\.jsonl$/;

/** The session a path belongs to — the directory between `session-state` and `events.jsonl` (or a rotated segment). */
export function copilotSessionIdFromPath(path: string, allowRotated = false): string | undefined {
  const parts = path.split(/[/\\]/).filter((part) => part !== "");
  const state = parts.lastIndexOf(COPILOT_SESSION_STATE_DIR);
  const file = parts[state + 2];
  if (state < 0 || file === undefined) {
    return undefined;
  }
  const matches = allowRotated ? COPILOT_JOURNAL_FILE.test(file) : file === COPILOT_EVENTS_FILE;
  return matches ? parts[state + 1] : undefined;
}

/** The walk for usage scans: `session-state/<session-id>/events.jsonl` and rotated `events.<n>.jsonl` segments. */
export const COPILOT_SESSION_FILES = {
  match: (name: string): boolean => COPILOT_JOURNAL_FILE.test(name),
  maxDepth: 2
};
