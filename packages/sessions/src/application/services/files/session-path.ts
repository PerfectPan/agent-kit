import type { OperatingSystem } from "@rivus/agent-kit-platform/public";

/**
 * A session path or home in the form the sessions path helpers split (`joinPath`, `dirnamePath`, `basenamePath`).
 * On Windows `\` is a separator, so it becomes `/`, which Node's fs accepts there too; a target typed with `\` then
 * finds its Claude Code subagents, its Codex rollout name and its Grok session directory. Elsewhere `\` is an
 * ordinary filename character and the path keeps its spelling. Usage homes do not pass through here, so usage ids
 * keep the spelling they always had.
 */
export function sessionPath(path: string, os: OperatingSystem | undefined): string {
  return os === "win32" ? path.replaceAll("\\", "/") : path;
}
