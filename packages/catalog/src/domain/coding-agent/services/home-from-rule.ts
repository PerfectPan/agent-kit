import type { AgentHome, HomeContext, HomeRule } from "../value-objects/agent-home.js";
import type { CodingAgentId } from "../value-objects/coding-agent-id.js";

// Paths use `/`: Node accepts it on Windows too, and the kit's path helpers split on it. A root keeps its separator,
// because `C:` without one is a drive-relative path.
function joinSegments(base: string, segments: readonly string[]): string {
  const trimmed = base.replace(/[/\\]+$/, "");
  const root = trimmed === "" || /^[A-Za-z]:$/.test(trimmed) ? base.slice(0, trimmed.length + 1) : trimmed;
  if (segments.length === 0) {
    return root;
  }
  return /[/\\]$/.test(root) ? root + segments.join("/") : [root, ...segments].join("/");
}

/** A blank variable counts as unset, as the agents themselves treat it. */
export function homeFromRule(agent: CodingAgentId, rule: HomeRule, context: HomeContext): AgentHome {
  const override = rule.envVar === undefined ? undefined : context.env[rule.envVar]?.trim();
  if (rule.envVar !== undefined && override !== undefined && override !== "") {
    const base =
      rule.expandsTilde && /^~(?:[/\\]|$)/.test(override)
        ? joinSegments(context.home, [override.slice(2)].filter(Boolean))
        : override;
    return {
      agent,
      path: joinSegments(base, rule.envSubpath ?? []),
      source: { kind: "env", variable: rule.envVar }
    };
  }
  return { agent, path: joinSegments(context.home, rule.defaultPath), source: { kind: "default" } };
}
