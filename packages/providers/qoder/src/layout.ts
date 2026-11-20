import type { AgentHome } from "@rivus/agent-kit-catalog/spi";
import { joinPath } from "@rivus/agent-kit-sessions/spi";
import { QODER_PROJECTS_DIR, QODER_SESSION_SUFFIX, QODER_SUBAGENTS_DIR } from "./facts.js";

// Qoder CLI stores sessions under `<home>/projects/<encoded-cwd>/<sessionId>.jsonl`, and subagent transcripts under
// `<home>/projects/<encoded-cwd>/<sessionId>/subagents/agent-<agentId>.jsonl` (verified in qodercli 1.1.88).

export function qoderRoots(home: AgentHome): string[] {
  return [joinPath(home.path, QODER_PROJECTS_DIR)];
}

interface QoderUsageTargetInfo {
  readonly sessionId: string;
  readonly agentLaneId?: string;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

/** Parses a main session or subagent transcript path under `projects/`. */
export function qoderUsageTarget(path: string): QoderUsageTargetInfo | undefined {
  const parts = normalizePath(path)
    .split("/")
    .filter((part) => part !== "");
  const filename = parts.at(-1);
  if (filename === undefined || !filename.endsWith(QODER_SESSION_SUFFIX)) {
    return undefined;
  }
  const stem = filename.slice(0, -QODER_SESSION_SUFFIX.length);
  if (stem === "") {
    return undefined;
  }
  if (parts.at(-2) === QODER_SUBAGENTS_DIR) {
    const sessionId = parts.at(-3);
    if (
      parts.at(-5) !== QODER_PROJECTS_DIR ||
      sessionId === undefined ||
      !stem.startsWith("agent-") ||
      stem.length <= "agent-".length
    ) {
      return undefined;
    }
    return { sessionId, agentLaneId: stem.slice("agent-".length) };
  }
  // Main session: `<projects>/<encoded-cwd>/<sessionId>.jsonl`.
  if (parts.at(-3) !== QODER_PROJECTS_DIR) {
    return undefined;
  }
  return { sessionId: stem };
}

export function qoderIsMainSessionPath(path: string): boolean {
  const info = qoderUsageTarget(path);
  return info !== undefined && info.agentLaneId === undefined;
}

export function qoderUsageSourceId(path: string): string {
  const info = qoderUsageTarget(path);
  if (info === undefined) {
    return normalizePath(path);
  }
  return info.agentLaneId === undefined ? info.sessionId : `${info.sessionId}/agent-${info.agentLaneId}`;
}

/** Matches main sessions (`depth 1`) and subagent transcripts (`depth 3`) under `projects/`. */
export const QODER_USAGE_FILES = {
  match: (name: string): boolean => name.endsWith(QODER_SESSION_SUFFIX),
  maxDepth: 3
};
