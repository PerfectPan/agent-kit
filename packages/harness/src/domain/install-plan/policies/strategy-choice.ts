import { type CodingAgentId, err, ok, type Result } from "@rivus/agent-kit-catalog";

import type { ArtifactSpec } from "../../bundle/value-objects/artifact-spec.js";
import type { InstallAdapter } from "../../bundle/value-objects/install-adapter.js";
import type { Strategy } from "../../bundle/value-objects/strategy.js";
import type { StrategyUnavailable } from "../errors/strategy-unavailable.js";

export type StrategyArtifactKind = "hooks" | "skill";

/** What an adapter must install one Artifact spec as for one agent: nothing (no events), a kind, or not at all. */
export type StrategyRequirement = StrategyArtifactKind | "skip" | "unsupported";

export interface StrategyChoice {
  /** A strategy per artifact kind that replaces the adapter's preference; an adapter that lacks it is unavailable. */
  readonly override?: Strategy;
  /** Executables the use case found on `PATH`, probed from the adapter's `requires` before the plan is rendered. */
  readonly available: ReadonlySet<string>;
}

/**
 * Whether the agent takes this Artifact at all: a hook spec that names none of the agent's events needs no strategy,
 * while MCP servers and instructions have no built-in strategy for any agent.
 */
export function strategyRequirement(spec: ArtifactSpec, agent: CodingAgentId): StrategyRequirement {
  if (spec.type === "skill") {
    return "skill";
  }
  if (spec.type === "hooks") {
    return (spec.events[agent]?.length ?? 0) > 0 ? "hooks" : "skip";
  }
  return "unsupported";
}

/**
 * The strategy for one Artifact kind of one agent: the caller's override when the adapter declares it, otherwise the
 * first strategy the adapter declares (its own order of preference) whose required executable is available. A
 * strategy with no requirement is always available. An override the adapter does not declare, or required executables
 * missing from `PATH`, is `StrategyUnavailable`.
 */
export function chooseStrategy(
  adapter: InstallAdapter,
  artifact: StrategyArtifactKind,
  choice: StrategyChoice
): Result<Strategy, StrategyUnavailable> {
  const supported = (artifact === "hooks" ? adapter.hookStrategies : adapter.skillStrategies) ?? [];
  const candidates =
    choice.override === undefined ? supported : supported.filter((strategy) => strategy === choice.override);
  const missing: { readonly strategy: Strategy; readonly command: string }[] = [];
  for (const strategy of candidates) {
    const command = adapter.requires?.[strategy];
    if (command === undefined || choice.available.has(command)) {
      return ok(strategy);
    }
    missing.push({ strategy, command });
  }
  return err({ _tag: "StrategyUnavailable", agent: adapter.agent, artifact, missing });
}

/** The failure for an Artifact kind no adapter installs, reported against the first selected agent. */
export function strategyUnsupported(agent: CodingAgentId, spec: ArtifactSpec): StrategyUnavailable {
  return { _tag: "StrategyUnavailable", agent, artifact: spec.type, missing: [] };
}

/** The commands an adapter may need for either Artifact kind, so the use case can probe `PATH` once per agent. */
export function requiredCommands(adapter: InstallAdapter): readonly string[] {
  const strategies = [...(adapter.hookStrategies ?? []), ...(adapter.skillStrategies ?? [])];
  return [
    ...new Set(
      strategies.flatMap((strategy) => {
        const command = adapter.requires?.[strategy];
        return command === undefined ? [] : [command];
      })
    )
  ];
}
