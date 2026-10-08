import { AgentKitError, type CodingAgentId } from "@rivus/agent-kit-catalog";
import { PlatformService } from "@rivus/agent-kit-platform/effect";
import * as Effect from "effect/Effect";

import { builtinHookDialects } from "../../domain/adapters/hook-dialects.js";
import { builtinInstallAdapters } from "../../domain/adapters/install-adapters.js";
import {
  type ArtifactSource,
  type Bundle,
  type BundleRef,
  checkBundle,
  type DroppedHook,
  droppedHooksOf,
  type HookCompat,
  type HookOverlap,
  type HookSpecRejected,
  type InstallAdapter,
  type InstallAdapters,
  type InstallContext,
  type InvalidBundle,
  type InvalidHookPlacement,
  placeHooks,
  type RenderedArtifact,
  type Strategy
} from "../../domain/bundle/index.js";
import {
  type ArtifactLocator,
  buildInstallPlan,
  chooseStrategy,
  type ConflictChoice,
  contentAfterStep,
  type DesiredArtifact,
  type ForeignHookObservation,
  type InstallPlan as PlanAggregate,
  type InvalidPlan,
  type LegacyHookSource,
  type LocatorKey,
  locatorKey,
  type ObservedArtifact,
  planEvidenceScope,
  type PlanConflict,
  type PlanStale,
  type PlanStep,
  registrationCommands,
  requiredCommands,
  strategyRequirement,
  strategyUnsupported,
  touchesDisk
} from "../../domain/install-plan/index.js";
import type { ArtifactContent, Ledger, PendingOperations } from "../../domain/ledger/index.js";
import type { HookDialects } from "../../domain/lifecycle/index.js";
import { hashContent } from "../services/content-hash.js";
import { observation, observe, registrationLookup } from "../services/observe.js";
import { resolveIo, resolvePath } from "../services/resolve-path.js";
import type { StrategyUnavailable } from "../errors.js";
import { fromResult } from "../services/from-result.js";
import {
  type InstallPlan,
  type PlannedCommand,
  type PlannedFileChange,
  registerPlan
} from "../services/install-plan-handle.js";
import { ledgerScope, type ScopeOptions } from "../services/ledger-scope.js";
import {
  DEFAULT_LOCK_WAIT_MS,
  type LedgerLockError,
  type LedgerReadError,
  loadLedger,
  type LoadedLedger,
  lockLedger
} from "../services/ledger-session.js";
import {
  AgentCli,
  ArtifactFiles,
  type ArtifactFailure,
  type ArtifactIoFailure,
  ExternalOwner,
  type LedgerLock,
  type LedgerScope,
  LedgerStore
} from "../ports.js";

export interface PlanInstallOptions extends ScopeOptions {
  /** The agents to install into. The plan covers the owner's Artifacts for these agents only. */
  readonly agents: readonly CodingAgentId[];
  /** Explicit decisions for conflicting locators, keyed by `locatorKey`; see `PlanConflict` for what each allows. */
  readonly choices?: Readonly<Record<LocatorKey, ConflictChoice>>;
  /** A strategy per agent that replaces the adapter's preference, such as `shared-config` for hooks. */
  readonly strategies?: Readonly<
    Partial<Record<CodingAgentId, { readonly hooks?: Strategy; readonly skills?: Strategy }>>
  >;
  /** What the application read about runners of other agents' hooks, such as Grok's `[compat.claude] hooks = false`. */
  readonly compat?: readonly HookCompat[];
  /** Install adapters for this call, merged over `builtinInstallAdapters`. */
  readonly adapters?: InstallAdapters;
  /** Hook dialects for this call, merged over `builtinHookDialects`. */
  readonly dialects?: HookDialects;
  /** How long to wait for the LedgerLock when an earlier change left operations to recover; 10 s by default. */
  readonly lockWaitMs?: number;
}

export type PlanInstallError =
  | InvalidBundle
  | HookSpecRejected
  | HookOverlap
  | InvalidHookPlacement
  | StrategyUnavailable
  | PendingOperations
  | PlanStale
  | InvalidPlan
  | PlanConflict
  | ArtifactFailure
  | LedgerReadError
  | LedgerLockError;

export type HarnessServices = ArtifactFiles | LedgerStore | LedgerLock | AgentCli | ExternalOwner | PlatformService;

/** The adapters and context of one call, after merging the caller's adapters over the built-in ones. */
export interface PlanSetup {
  readonly adapters: InstallAdapters;
  readonly dialects: HookDialects;
  readonly context: InstallContext;
}

export function planSetup(options: {
  readonly adapters?: InstallAdapters;
  readonly dialects?: HookDialects;
}): Effect.Effect<PlanSetup, never, PlatformService> {
  return Effect.gen(function* () {
    const platform = yield* PlatformService;
    return {
      adapters: { ...builtinInstallAdapters, ...options.adapters },
      dialects: { ...builtinHookDialects, ...options.dialects },
      context: { home: platform.home, env: platform.env }
    };
  });
}

export function adapterOf(setup: PlanSetup, agent: CodingAgentId): InstallAdapter {
  const adapter = Object.hasOwn(setup.adapters, agent) ? setup.adapters[agent] : undefined;
  if (adapter === undefined) {
    throw new AgentKitError("capability-unsupported", `Agent "${agent}" has no install adapter`);
  }
  return adapter;
}

/** Only the user scope has built-in adapters; a project scope needs adapters that know project paths. */
export function requireUserScope(options: ScopeOptions): void {
  if ((options.scope ?? "user") !== "user") {
    throw new AgentKitError("capability-unsupported", "The built-in install adapters support the user scope only");
  }
}

/**
 * Probes every command the selected agents' strategies may need, so rendering decides on `PATH` once per agent. An
 * agent this call has no adapter for is skipped: verify renders by the ledger's agents, and rendering reports the
 * missing adapter itself when a strategy is actually needed there.
 */
export function probeCommands(
  agents: readonly CodingAgentId[],
  setup: PlanSetup
): Effect.Effect<ReadonlyMap<CodingAgentId, ReadonlySet<string>>, never, AgentCli> {
  return Effect.gen(function* () {
    const cli = yield* AgentCli;
    const available = new Map<CodingAgentId, Set<string>>();
    for (const agent of agents) {
      const adapter = Object.hasOwn(setup.adapters, agent) ? setup.adapters[agent] : undefined;
      if (adapter === undefined) {
        continue;
      }
      const found = new Set<string>();
      for (const command of requiredCommands(adapter)) {
        if (yield* cli.available(command)) {
          found.add(command);
        }
      }
      available.set(agent, found);
    }
    return available;
  });
}

interface Rendered {
  readonly agent: CodingAgentId;
  readonly artifact: RenderedArtifact;
}

export interface RenderOptions extends Pick<PlanInstallOptions, "strategies" | "compat"> {
  /** Executables `probeCommands` found on `PATH`, per agent. */
  readonly available: ReadonlyMap<CodingAgentId, ReadonlySet<string>>;
}

/** The bundle's Artifacts for the agents, as their adapters render them, with the hooks placed across agents. */
export function renderBundle(
  bundle: Bundle,
  agents: readonly CodingAgentId[],
  setup: PlanSetup,
  options: RenderOptions
): Effect.Effect<
  { readonly rendered: readonly Rendered[]; readonly droppedHooks: readonly DroppedHook[] },
  HookSpecRejected | HookOverlap | InvalidHookPlacement | StrategyUnavailable,
  never
> {
  return Effect.gen(function* () {
    const rendered: Rendered[] = [];
    const droppedHooks: DroppedHook[] = [];
    for (const spec of bundle.artifacts) {
      // No adapter installs a spec other than hooks or skills (`strategyRequirement` says `unsupported` for every
      // agent), reported against the first selected one; with none selected nothing renders.
      const unsupported = agents.find((agent) => strategyRequirement(spec, agent) === "unsupported");
      if (unsupported !== undefined) {
        return yield* Effect.fail(strategyUnsupported(unsupported, spec));
      }
      if (spec.type === "hooks") {
        const placements: { agent: CodingAgentId; file: string; strategy: Strategy }[] = [];
        for (const agent of agents) {
          if (strategyRequirement(spec, agent) === "skip") {
            continue;
          }
          const adapter = adapterOf(setup, agent);
          const strategy = yield* fromResult(
            chooseStrategy(adapter, "hooks", {
              ...(options.strategies?.[agent]?.hooks === undefined
                ? {}
                : { override: options.strategies[agent]!.hooks }),
              available: options.available.get(agent) ?? new Set<string>()
            })
          );
          placements.push({ agent, file: adapter.hookFile(strategy, bundle), strategy });
        }
        const placed = yield* fromResult(
          placeHooks(
            spec,
            placements.map(({ agent, file }) => ({ agent, file })),
            setup.dialects,
            options.compat === undefined ? {} : { compat: options.compat }
          )
        );
        for (const [index, hooks] of placed.entries()) {
          const { strategy } = placements[index] ?? { strategy: "native-plugin" as const };
          const adapter = adapterOf(setup, hooks.agent);
          for (const artifact of adapter.renderHooks(strategy, hooks.registrations, bundle, setup.context)) {
            rendered.push({ agent: hooks.agent, artifact });
          }
        }
        droppedHooks.push(...droppedHooksOf(placed));
        continue;
      }
      if (spec.type !== "skill") {
        continue;
      }
      for (const agent of agents) {
        const adapter = adapterOf(setup, agent);
        const strategy = yield* fromResult(
          chooseStrategy(adapter, "skill", {
            ...(options.strategies?.[agent]?.skills === undefined
              ? {}
              : { override: options.strategies[agent]!.skills }),
            available: options.available.get(agent) ?? new Set<string>()
          })
        );
        for (const artifact of adapter.renderSkill(strategy, spec, setup.context)) {
          rendered.push({ agent, artifact });
        }
      }
    }
    return { rendered, droppedHooks };
  });
}

/** Resolves each rendered Artifact's path and hashes its content, once per agent that relies on it. */
export function desiredArtifacts(
  rendered: readonly Rendered[]
): Effect.Effect<readonly DesiredArtifact[], ArtifactIoFailure, PlatformService> {
  return Effect.gen(function* () {
    const desired: DesiredArtifact[] = [];
    for (const { agent, artifact } of rendered) {
      const locator = { ...artifact.locator, path: yield* resolvePath(artifact.locator.path) };
      const hash = yield* hashContent(locator.kind, artifact.content);
      for (const user of artifact.agents ?? [agent]) {
        desired.push({
          agent: user,
          locator,
          content: artifact.content,
          hash,
          strategy: artifact.strategy,
          ...(artifact.trust === undefined ? {} : { trust: artifact.trust })
        });
      }
    }
    return desired;
  });
}

interface LegacyObservation {
  readonly observed: ObservedArtifact;
  readonly runner?: CodingAgentId;
  readonly event?: string;
}

function scanLegacy(
  sources: readonly LegacyHookSource[]
): Effect.Effect<readonly LegacyObservation[], ArtifactFailure, ArtifactFiles | PlatformService> {
  return Effect.gen(function* () {
    const files = yield* ArtifactFiles;
    const found: LegacyObservation[] = [];
    for (const { source, events, runner, runAs } of sources) {
      const resolved: ArtifactSource =
        source.kind === "files"
          ? { ...source, dir: yield* resolvePath(source.dir, true) }
          : { ...source, path: yield* resolvePath(source.path) };
      for (const { locator, read } of yield* files.scan(resolved)) {
        const event = locator.pointer?.split("/").at(-1)?.replaceAll("~1", "/").replaceAll("~0", "~");
        if (events === undefined || (event !== undefined && events.has(event))) {
          found.push({
            observed: yield* observation(locator, read),
            ...(runner === undefined ? {} : { runner }),
            ...(event === undefined || runAs?.[event] === undefined ? {} : { event: runAs[event] })
          });
        }
      }
    }
    return found;
  });
}

/** The paths that are symlinks themselves, with what they point to, found without following them. */
function linkedPaths(
  paths: readonly string[]
): Effect.Effect<Readonly<Record<string, string>>, ArtifactIoFailure, PlatformService> {
  return Effect.gen(function* () {
    const { fs } = yield* PlatformService;
    const linked: Record<string, string> = {};
    for (const path of paths) {
      const target = yield* Effect.tryPromise({
        try: async () => ((await fs.stat(path))?.kind === "symlink" ? ((await fs.realpath(path)) ?? path) : undefined),
        catch: (cause) => resolveIo(path, cause)
      });
      if (target !== undefined) {
        linked[path] = target;
      }
    }
    return linked;
  });
}

export interface PlanInput {
  readonly bundle: Bundle;
  readonly agents: readonly CodingAgentId[];
  readonly setup: PlanSetup;
  readonly desired: readonly DesiredArtifact[];
  readonly droppedHooks: readonly DroppedHook[];
  readonly choices?: Readonly<Record<LocatorKey, ConflictChoice>>;
  readonly compat?: readonly HookCompat[];
}

/**
 * Observes everything the plan may touch (the desired locators, every locator the owner holds, and where older
 * versions of the owner may have left something) and builds the plan against `loaded`; the view and its record for
 * `registerPlan`.
 */
export function buildPlan(
  scope: LedgerScope,
  loaded: LoadedLedger,
  input: PlanInput
): Effect.Effect<
  InstallPlan,
  PendingOperations | PlanStale | InvalidPlan | PlanConflict | ArtifactFailure | LedgerReadError,
  ArtifactFiles | ExternalOwner | LedgerStore | PlatformService
> {
  return Effect.gen(function* () {
    const { bundle, agents, setup } = input;
    const { ledger } = loaded;
    const evidenceScope = planEvidenceScope({
      bundle,
      agents,
      desired: input.desired,
      ledger,
      adapters: setup.adapters,
      dialects: setup.dialects,
      context: setup.context,
      ...(input.compat === undefined ? {} : { compat: input.compat })
    });
    const locators = new Map<LocatorKey, ArtifactLocator>();
    for (const locator of evidenceScope.locators) {
      locators.set(locatorKey(locator), locator);
    }
    const observed = new Map<LocatorKey, ObservedArtifact>();
    for (const [key, locator] of locators) {
      const found = yield* observe(locator, registrationLookup(setup.adapters, setup.context));
      if (found !== undefined) {
        observed.set(key, found);
      }
    }
    const foreignHooks: ForeignHookObservation[] = [];
    if (evidenceScope.scanLegacy && evidenceScope.legacySources.length > 0) {
      for (const observation of yield* scanLegacy(evidenceScope.legacySources)) {
        const found = observation.observed;
        if (observation.runner !== undefined && observation.event !== undefined) {
          foreignHooks.push({ observed: found, runner: observation.runner, event: observation.event });
        }
        if (!observed.has(locatorKey(found.locator))) {
          observed.set(locatorKey(found.locator), found);
        }
      }
    }
    const paths = [
      ...new Set([...locators.values(), ...[...observed.values()].map((found) => found.locator)].map((l) => l.path))
    ];
    const managed = yield* (yield* ExternalOwner).managedPaths(paths);
    const linked = yield* linkedPaths(paths);
    const roots: string[] = [];
    for (const candidate of evidenceScope.rootCandidates) {
      roots.push(yield* resolvePath(candidate, true));
    }
    const aggregate = yield* fromResult(
      buildInstallPlan(
        {
          planId: crypto.randomUUID(),
          bundle,
          target: { scope: scope.scope, agents, roots: [...new Set(roots)] },
          desired: input.desired,
          ...(input.choices === undefined ? {} : { choices: input.choices }),
          managedPaths: Object.fromEntries(managed),
          linkedPaths: linked,
          foreignHooks,
          dialects: setup.dialects
        },
        ledger,
        [...observed.values()]
      )
    );
    const view = yield* describePlan(scope, aggregate, ledger, observed, input);
    return registerPlan(view, { scope, adapters: setup.adapters, context: setup.context, aggregate });
  });
}

/** The content a step leaves at its target, or `undefined` when it leaves nothing or does not write there. */
export function contentAfter(
  scope: LedgerScope,
  step: PlanStep,
  ledger: Ledger
): Effect.Effect<ArtifactContent | undefined, LedgerReadError, LedgerStore> {
  return Effect.gen(function* () {
    const after = contentAfterStep(step, ledger.entry(step.locator)?.preImage);
    if (after === undefined || "desired" in after) {
      return after?.desired;
    }
    return yield* (yield* LedgerStore).getPreImage(scope, after.preImage);
  });
}

/** A directory's content as files by relative path; nothing for anything else. */
function filesOf(content: ArtifactContent | undefined): Readonly<Record<string, ArtifactContent>> {
  return typeof content === "object" && content !== null && !Array.isArray(content)
    ? (content as Readonly<Record<string, ArtifactContent>>)
    : {};
}

function textOf(content: ArtifactContent | undefined): string | undefined {
  return typeof content === "string" ? content : content === undefined ? undefined : JSON.stringify(content);
}

/** Each file's text before and after, and the command lines, for the steps that change something on disk. */
function describePlan(
  scope: LedgerScope,
  aggregate: PlanAggregate,
  ledger: Ledger,
  observed: ReadonlyMap<LocatorKey, ObservedArtifact>,
  input: PlanInput
): Effect.Effect<Omit<InstallPlan, "status">, ArtifactFailure | LedgerReadError, ArtifactFiles | LedgerStore> {
  return Effect.gen(function* () {
    const files = yield* ArtifactFiles;
    const changes: PlannedFileChange[] = [];
    const commands: PlannedCommand[] = [];
    const entryChanges = new Map<
      string,
      { format: "json" | "toml"; changes: { locator: ArtifactLocator; content: ArtifactContent | undefined }[] }
    >();
    for (const step of aggregate.steps) {
      if (!touchesDisk(step)) {
        continue;
      }
      const { locator } = step;
      const after = yield* contentAfter(scope, step, ledger);
      const before = observed.get(locatorKey(locator))?.content;
      switch (locator.kind) {
        case "json-entry":
        case "toml-entry": {
          const format = locator.kind === "toml-entry" ? "toml" : "json";
          const pending = entryChanges.get(locator.path) ?? { format, changes: [] };
          pending.changes.push({ locator, content: after });
          entryChanges.set(locator.path, pending);
          break;
        }
        case "dir": {
          const was = filesOf(before);
          const will = filesOf(after);
          for (const name of [...new Set([...Object.keys(was), ...Object.keys(will)])].toSorted()) {
            const beforeText = textOf(was[name]);
            const afterText = textOf(will[name]);
            if (beforeText !== afterText) {
              changes.push({
                path: `${locator.path}/${name}`,
                ...(beforeText === undefined ? {} : { before: beforeText }),
                ...(afterText === undefined ? {} : { after: afterText })
              });
            }
          }
          break;
        }
        case "cli-registration": {
          const commandsForStep = registrationCommands(step, ledger.entry(locator));
          if (commandsForStep === undefined || commandsForStep.purposes.length === 0) {
            break;
          }
          const registration = registrationLookup(input.setup.adapters, input.setup.context)(locator);
          if (registration !== undefined) {
            for (const purpose of commandsForStep.purposes) {
              commands.push({ agent: commandsForStep.agent, ...registration[purpose], purpose, locator });
            }
          }
          break;
        }
        default: {
          const beforeText = textOf(before);
          const afterText = textOf(after);
          changes.push({
            path: locator.path,
            ...(beforeText === undefined ? {} : { before: beforeText }),
            ...(afterText === undefined ? {} : { after: afterText })
          });
        }
      }
    }
    for (const [path, { format, changes: edits }] of entryChanges) {
      changes.push({ path, ...(yield* files.preview(path, format, edits)) });
    }
    const { planId, basedOn, bundle, steps, expectedTrustPrompts, notes } = aggregate.toSnapshot();
    return {
      planId,
      bundle: bundle as BundleRef,
      agents: input.agents,
      basedOn,
      steps,
      changes,
      commands,
      expectedTrustPrompts,
      notes,
      droppedHooks: input.droppedHooks
    };
  });
}

/**
 * Plans the installation of a bundle into agents, without writing: renders the bundle with each agent's preferred
 * strategy (hooks placed so that no event fires twice in an agent that runs another agent's hooks), reads what is on
 * disk and in the ledger, and checks the plan invariants. A plan with a conflict and no explicit choice fails with
 * `PlanConflict`, listing the choices that would resolve each. When an earlier change left operations pending, it
 * takes the LedgerLock long enough to probe and settle them first.
 */
export function planInstall(
  bundle: Bundle,
  options: PlanInstallOptions
): Effect.Effect<InstallPlan, PlanInstallError, HarnessServices> {
  return Effect.gen(function* () {
    requireUserScope(options);
    const checked = yield* fromResult(checkBundle(bundle));
    const setup = yield* planSetup(options);
    for (const agent of options.agents) {
      adapterOf(setup, agent);
    }
    const scope = yield* ledgerScope(options);
    let loaded = yield* loadLedger(scope);
    if (loaded.ledger.pending.length > 0) {
      const registrations = registrationLookup(setup.adapters, setup.context);
      const waitMs = options.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS;
      loaded = (yield* Effect.scoped(lockLedger(scope, { waitMs, registrations }))).loaded;
    }
    const available = yield* probeCommands(options.agents, setup);
    const { rendered, droppedHooks } = yield* renderBundle(checked, options.agents, setup, {
      ...options,
      available
    });
    const desired = yield* desiredArtifacts(rendered);
    return yield* buildPlan(scope, loaded, {
      bundle: checked,
      agents: options.agents,
      setup,
      desired,
      droppedHooks,
      ...(options.compat === undefined ? {} : { compat: options.compat }),
      ...(options.choices === undefined ? {} : { choices: options.choices })
    });
  });
}
