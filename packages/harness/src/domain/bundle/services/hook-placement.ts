import { AgentKitError, type CodingAgentId, err, ok, type Result } from "@rivus/agent-kit-catalog";

import type { HookDialect, HookDialects } from "../../lifecycle/value-objects/hook-dialect.js";
import type { HookSpec } from "../value-objects/artifact-spec.js";
import {
  foreignHooksIn,
  type HookCompat,
  type HookRegistration,
  hookRegistrations,
  type HookSpecRejected,
  runnersOf
} from "./hook-registrations.js";

/** Where one agent's hooks of a bundle go: a configuration file, written as in `ForeignHooks.files`. */
export interface HookPlacement {
  readonly agent: CodingAgentId;
  /**
   * `~/` and a path under the home, or a path relative to the project root, such as `~/.claude/settings.json`: the
   * notation the dialects' `runsHooksOf` use, which is how other agents that run this file are found.
   */
  readonly file: string;
}

export interface PlacedRegistration extends HookRegistration {
  /**
   * The placed agents that rely on this registration: its own agent, and every agent that runs hooks from this file
   * and dropped its own registration of the event for it. Render one DesiredArtifact per agent, so the plan and the
   * ledger record them all and uninstalling one of them releases the registration instead of deleting it.
   */
  readonly agents: readonly CodingAgentId[];
}

export interface PlacedHooks extends HookPlacement {
  readonly registrations: readonly PlacedRegistration[];
}

export interface HookPlacementOptions {
  /**
   * What the application knows about runners that load other agents' hooks, for de-duplication only; `byDefault`
   * decides the rest. The gate check ignores it (see `runnersOf`).
   */
  readonly compat?: readonly HookCompat[];
}

/**
 * An event that would fire more than once in `agent`, placed or not, whichever registration is dropped: it runs the
 * hooks of several placed files that map to it. `event` is `*` when the placed agents run each other's hooks in a
 * cycle.
 */
export interface HookOverlap {
  readonly _tag: "HookOverlap";
  readonly agent: CodingAgentId;
  readonly event: string;
  readonly sources: readonly { readonly agent: CodingAgentId; readonly event: string }[];
}

/**
 * Placements that cannot be judged: one agent placed twice would fire each event twice in it, and a file outside the
 * `~/` or project-relative notation matches no `runsHooksOf` entry, so other agents running it would go unnoticed.
 */
export interface InvalidHookPlacement {
  readonly _tag: "InvalidHookPlacement";
  readonly agent: CodingAgentId;
  readonly file: string;
  readonly reason: "repeated-agent" | "not-home-or-project-relative";
}

function placementProblem(
  placement: HookPlacement,
  index: number,
  placements: readonly HookPlacement[]
): InvalidHookPlacement | undefined {
  const { agent, file } = placement;
  if (placements.slice(0, index).some((earlier) => earlier.agent === agent)) {
    return { _tag: "InvalidHookPlacement", agent, file, reason: "repeated-agent" };
  }
  const relative = file.startsWith("~/") ? file.slice(2) : file;
  const valid =
    !/^(?:[\\/~]|[A-Za-z]:)/.test(relative) &&
    !relative.includes("\\") &&
    relative.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
  return valid ? undefined : { _tag: "InvalidHookPlacement", agent, file, reason: "not-home-or-project-relative" };
}

interface Kept {
  readonly registration: HookRegistration;
  readonly agents: CodingAgentId[];
}

type Incoming = Map<string, { readonly agent: CodingAgentId; readonly event: string; readonly kept: Kept }[]>;

/** The kept registrations of the placed files `runner` runs, grouped by the event `runner` runs each one as. */
function incomingTo(
  runner: HookDialect,
  sources: readonly HookPlacement[],
  settled: ReadonlyMap<HookPlacement, readonly Kept[]>,
  compat: readonly HookCompat[]
): Incoming {
  const incoming: Incoming = new Map();
  for (const source of sources) {
    const renames = foreignHooksIn(runner, source.agent, source.file, compat)?.events ?? {};
    for (const kept of settled.get(source) ?? []) {
      const event = Object.hasOwn(renames, kept.registration.event) ? renames[kept.registration.event] : undefined;
      if (event !== undefined) {
        incoming.set(event, [
          ...(incoming.get(event) ?? []),
          { agent: source.agent, event: kept.registration.event, kept }
        ]);
      }
    }
  }
  return incoming;
}

function overlapIn(agent: CodingAgentId, incoming: Incoming): HookOverlap | undefined {
  for (const [event, sources] of incoming) {
    if (sources.length > 1) {
      return {
        _tag: "HookOverlap",
        agent,
        event,
        sources: sources.map((source) => ({ agent: source.agent, event: source.event }))
      };
    }
  }
  return undefined;
}

/**
 * Hook registrations for several agents at once, so that no event fires twice in an agent that also runs another
 * agent's hooks (Grok and Cursor run the hooks in Claude Code's settings files). Each agent's registrations are
 * checked with `hookRegistrations`, including the gates of every agent that runs its file. Agents are then settled
 * after the agents whose files they run: an agent's own registration of an event is dropped when exactly one kept
 * registration elsewhere already fires it there. Every agent that runs placed files, placed or not, must then get each
 * event from one registration at most. A file no other agent runs, such as a Claude Code skills-dir plugin, keeps
 * every agent's registrations.
 */
export function placeHooks(
  spec: HookSpec,
  placements: readonly HookPlacement[],
  dialects: HookDialects,
  options: HookPlacementOptions = {}
): Result<readonly PlacedHooks[], HookSpecRejected | HookOverlap | InvalidHookPlacement> {
  const compat = options.compat ?? [];
  const dialectOf = (agent: CodingAgentId): HookDialect => {
    const dialect = Object.hasOwn(dialects, agent) ? dialects[agent] : undefined;
    if (dialect === undefined) {
      throw new AgentKitError("capability-unsupported", `Agent "${agent}" has no hook dialect`);
    }
    return dialect;
  };
  const own = new Map<HookPlacement, readonly HookRegistration[]>();
  for (const [index, placement] of placements.entries()) {
    const problem = placementProblem(placement, index, placements);
    if (problem !== undefined) {
      return err(problem);
    }
    const registrations = hookRegistrations(spec, dialectOf(placement.agent), {
      runBy: runnersOf(placement.agent, placement.file, dialects)
    });
    if (!registrations.ok) {
      return registrations;
    }
    own.set(placement, registrations.value);
  }

  const sourcesOf = (runner: HookDialect): HookPlacement[] =>
    placements.filter(
      (source) =>
        source.agent !== runner.agent && foreignHooksIn(runner, source.agent, source.file, compat) !== undefined
    );
  const settled = new Map<HookPlacement, Kept[]>();
  let pending = [...placements];
  while (pending.length > 0) {
    const ready = pending.filter((placement) =>
      sourcesOf(dialectOf(placement.agent)).every((source) => settled.has(source))
    );
    if (ready.length === 0) {
      return err({
        _tag: "HookOverlap",
        agent: pending[0]?.agent ?? "",
        event: "*",
        sources: pending.map((placement) => ({ agent: placement.agent, event: "*" }))
      });
    }
    for (const placement of ready) {
      const runner = dialectOf(placement.agent);
      const incoming = incomingTo(runner, sourcesOf(runner), settled, compat);
      const overlap = overlapIn(placement.agent, incoming);
      if (overlap !== undefined) {
        return err(overlap);
      }
      const kept = (own.get(placement) ?? []).flatMap((registration) => {
        const [covering] = incoming.get(registration.event) ?? [];
        covering?.kept.agents.push(placement.agent);
        return covering === undefined ? [{ registration, agents: [placement.agent] }] : [];
      });
      settled.set(placement, kept);
    }
    pending = pending.filter((placement) => !settled.has(placement));
  }
  for (const runner of Object.values(dialects)) {
    if (runner !== undefined && !placements.some((placement) => placement.agent === runner.agent)) {
      const overlap = overlapIn(runner.agent, incomingTo(runner, sourcesOf(runner), settled, compat));
      if (overlap !== undefined) {
        return err(overlap);
      }
    }
  }
  return ok(
    placements.map((placement) => ({
      ...placement,
      registrations: (settled.get(placement) ?? []).map(({ registration, agents }) => ({
        ...registration,
        agents: [...agents].toSorted()
      }))
    }))
  );
}
