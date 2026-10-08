import type { CodingAgentId } from "@rivus/agent-kit-catalog";
import { PlatformService } from "@rivus/agent-kit-platform/effect";
import * as Effect from "effect/Effect";

import type { HookSource, InstallAdapters, Owner } from "../../domain/bundle/index.js";
import type { ArtifactLocator } from "../../domain/install-plan/index.js";
import { threeWayVerify } from "../../domain/ledger/index.js";
import type { HookDialect, HookDialects } from "../../domain/lifecycle/index.js";
import { ledgerScope, type ScopeOptions } from "../services/ledger-scope.js";
import { loadLedger } from "../services/ledger-session.js";
import { observe, registrationLookup } from "../services/observe.js";
import { type HarnessServices, planSetup, type PlanSetup, requireUserScope } from "./plan-install.js";
import { resolvePath } from "../services/resolve-path.js";
import { ArtifactFiles, LedgerLock } from "../ports.js";

/** One finding, in the shape of dotagents' checks: `fix` is left to a later `doctor --fix`. */
export interface Check {
  readonly name:
    | "ledger"
    | "pending"
    | "lock"
    | "drift"
    | "broken-symlink"
    | "unknown-event"
    | "timeout-unit"
    | "stale-path"
    | "duplicate-hook";
  readonly status: "ok" | "warn" | "error";
  readonly message: string;
  readonly locator?: ArtifactLocator;
}

export interface DoctorOptions extends ScopeOptions {
  /** Only this owner's ledger entries are compared with the disk; every owner's by default. */
  readonly owner?: Owner;
  /** The agents whose hook configuration is read; every agent with an install adapter by default. */
  readonly agents?: readonly CodingAgentId[];
  /**
   * Substrings that identify one application's hooks, such as its current command and its legacy markers: an event
   * that runs more than one of them in an agent is reported as firing twice.
   */
  readonly markers?: readonly string[];
  readonly adapters?: InstallAdapters;
  readonly dialects?: HookDialects;
}

const unquote = (token: string) => token.replace(/^["']|["']$/g, "");

/** Findings about one hook registration found in an agent's configuration. */
function hookChecks(
  dialect: HookDialect | undefined,
  locator: ArtifactLocator,
  hook: unknown,
  exists: (path: string) => boolean
): Check[] {
  const checks: Check[] = [];
  const event = (locator.pointer ?? "").split("/").at(-1)?.replaceAll("~1", "/").replaceAll("~0", "~") ?? "";
  const known =
    dialect === undefined ||
    Object.hasOwn(dialect.events, event) ||
    Object.values(dialect.events).some((spec) => spec.aliases?.includes(event) === true);
  if (!known) {
    checks.push({
      name: "unknown-event",
      status: "warn",
      message: `${dialect?.agent} has no hook event "${event}"; this hook never runs`,
      locator
    });
  }
  const timeout = typeof hook === "object" && hook !== null ? (hook as { timeout?: unknown }).timeout : undefined;
  if (dialect?.timeout?.unit === "milliseconds" && typeof timeout === "number" && timeout < 1000) {
    checks.push({
      name: "timeout-unit",
      status: "warn",
      message: `timeout ${timeout} is in milliseconds for ${dialect.agent}; it looks like seconds`,
      locator
    });
  }
  const [program] = (locator.member ?? "").trim().split(/\s+/).map(unquote);
  if (program !== undefined && program.startsWith("/") && !exists(program)) {
    checks.push({ name: "stale-path", status: "warn", message: `${program} does not exist`, locator });
  }
  return checks;
}

/** One command hook an agent runs, as `event` in the agent's own names. */
interface FoundHook {
  readonly event: string;
  readonly command: string;
  readonly hook: unknown;
  /** Where it is written; its pointer holds the event as that file names it. */
  readonly locator: ArtifactLocator;
  /** Written in one of the agent's own files rather than another agent's that it also runs. */
  readonly own: boolean;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The paths a source names, with each `*` segment expanded to the entries of its directory. */
function expand(pattern: string): Effect.Effect<readonly string[], never, PlatformService> {
  return Effect.gen(function* () {
    const { fs } = yield* PlatformService;
    let paths = [""];
    for (const segment of pattern.split("/").slice(1)) {
      if (!segment.includes("*")) {
        paths = paths.map((path) => `${path}/${segment}`);
        continue;
      }
      const matcher = new RegExp(
        `^${segment
          .split("*")
          .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
          .join(".*")}$`
      );
      const next: string[] = [];
      for (const dir of paths) {
        const entries = yield* Effect.promise(() => fs.list(dir).catch(() => []));
        next.push(...entries.filter((entry) => matcher.test(entry.name)).map((entry) => `${dir}/${entry.name}`));
      }
      paths = next;
    }
    return paths;
  });
}

/** The command hooks in one file, by the event the file names them under. */
function hooksInFile(
  source: HookSource,
  path: string
): Effect.Effect<readonly Omit<FoundHook, "own">[], never, ArtifactFiles> {
  return Effect.gen(function* () {
    const kind = source.format === "toml" ? "toml-entry" : "json-entry";
    const read = yield* Effect.orElseSucceed(
      (yield* ArtifactFiles).read({ kind, path, pointer: "/hooks" }),
      () => undefined
    );
    const events = isRecord(read?.content) ? read.content : {};
    const found: Omit<FoundHook, "own">[] = [];
    for (const [event, list] of Object.entries(events)) {
      const entries = Array.isArray(list) ? list : [];
      const hooks =
        source.layout === "grouped"
          ? entries.flatMap((group) => (isRecord(group) && Array.isArray(group.hooks) ? group.hooks : []))
          : entries;
      for (const hook of hooks) {
        if (isRecord(hook) && typeof hook.command === "string") {
          const pointer = `/hooks/${event.replaceAll("~", "~0").replaceAll("/", "~1")}`;
          const memberIn = source.layout === "grouped" ? "hook-group" : "element";
          found.push({
            event,
            command: hook.command,
            hook,
            locator: { kind, path, pointer, member: hook.command, memberIn }
          });
        }
      }
    }
    return found;
  });
}

/**
 * Every command hook `agent` runs: from its own files, and from the files of other agents it runs by default (Grok
 * and Cursor run Claude Code's settings file), renamed to its own event names.
 */
function agentHooks(
  agent: CodingAgentId,
  setup: PlanSetup
): Effect.Effect<readonly FoundHook[], never, ArtifactFiles | PlatformService> {
  return Effect.gen(function* () {
    const found: FoundHook[] = [];
    const read = Effect.fnUntraced(function* (
      source: HookSource,
      own: boolean,
      rename?: Readonly<Record<string, string>>
    ) {
      for (const path of yield* expand(source.path)) {
        const resolved = yield* Effect.orElseSucceed(resolvePath(path), () => path);
        for (const hook of yield* hooksInFile(source, resolved)) {
          const event = rename === undefined ? hook.event : rename[hook.event];
          if (event !== undefined) {
            found.push({ ...hook, event, own });
          }
        }
      }
    });
    for (const source of setup.adapters[agent]?.hookSources?.(setup.context) ?? []) {
      yield* read(source, true);
    }
    const dialect = Object.hasOwn(setup.dialects, agent) ? setup.dialects[agent] : undefined;
    for (const foreign of dialect?.runsHooksOf ?? []) {
      if (!foreign.byDefault) {
        continue;
      }
      for (const file of foreign.files.filter((name) => name.startsWith("~/"))) {
        const path = `${setup.context.home}/${file.slice(2)}`;
        const source = setup.adapters[foreign.agent]?.hookSources?.(setup.context).find((own) => own.path === path);
        if (source !== undefined) {
          yield* read(source, false, foreign.events);
        }
      }
    }
    return found;
  });
}

/**
 * Events that run a command twice in one agent, or, given an application's markers, more than one of that
 * application's hooks: an old hook left in a settings file next to the plugin that replaced it fires twice.
 */
function duplicates(agent: CodingAgentId, hooks: readonly FoundHook[], markers: readonly string[]): Check[] {
  const checks: Check[] = [];
  for (const event of new Set(hooks.map((hook) => hook.event))) {
    const here = hooks.filter((hook) => hook.event === event);
    const seen = new Set<string>();
    for (const hook of here) {
      if (seen.has(hook.command)) {
        checks.push({
          name: "duplicate-hook",
          status: "warn",
          message: `${agent} runs this hook twice for ${event}`,
          locator: hook.locator
        });
      }
      seen.add(hook.command);
    }
    const marked = here.filter((hook) => markers.some((marker) => marker !== "" && hook.command.includes(marker)));
    const last = marked.at(-1);
    if (last !== undefined && new Set(marked.map((hook) => hook.command)).size > 1) {
      checks.push({
        name: "duplicate-hook",
        status: "warn",
        message: `${agent} runs ${marked.length} hooks of one application for ${event}`,
        locator: last.locator
      });
    }
  }
  return checks;
}

/**
 * Reports, without changing anything an agent reads: whether the ledger is readable and has unfinished operations,
 * whether the LedgerLock is free (and what its holder recorded), owned Artifacts that drifted from the ledger or are
 * broken symlinks, and the command hooks each agent loads (its settings files and every plugin's or extension's hooks
 * file, plus the other agents' files it runs) that never run (unknown events), use the wrong timeout unit, point at a
 * missing program, or fire twice for one event: the same command twice, or, given `markers`, two hooks of one
 * application, such as an old hook in a settings file next to the plugin that replaced it. Taking the lock to test
 * it creates the lock files in the harness state directory and nothing else.
 */
export function doctor(options: DoctorOptions = {}): Effect.Effect<readonly Check[], never, HarnessServices> {
  return Effect.gen(function* () {
    requireUserScope(options);
    const scope = yield* ledgerScope(options);
    const setup = yield* planSetup(options);
    const platform = yield* PlatformService;
    const checks: Check[] = [];

    const loaded = yield* Effect.result(loadLedger(scope));
    if (loaded._tag === "Failure") {
      checks.push({ name: "ledger", status: "error", message: `the ledger cannot be used: ${loaded.failure._tag}` });
    } else {
      const { ledger } = loaded.success;
      checks.push({
        name: "ledger",
        status: "ok",
        message: `revision ${ledger.revision}, ${ledger.entries().length} entries`
      });
      if (ledger.pending.length > 0) {
        checks.push({
          name: "pending",
          status: "warn",
          message: `${ledger.pending.length} operations of an interrupted change; the next change probes them`
        });
      }
      for (const entry of ledger.entries()) {
        if (options.owner !== undefined && !entry.owners.includes(options.owner)) {
          continue;
        }
        const found = yield* Effect.result(observe(entry.locator, registrationLookup(setup.adapters, setup.context)));
        if (found._tag === "Failure") {
          checks.push({
            name: "drift",
            status: "error",
            message: `cannot read: ${found.failure._tag}`,
            locator: entry.locator
          });
          continue;
        }
        const seen = found.success;
        if (seen?.symlinkTarget !== undefined && seen.locator.kind === "symlink" && seen.content === "") {
          checks.push({
            name: "broken-symlink",
            status: "warn",
            message: "the symlink points nowhere",
            locator: entry.locator
          });
        }
        const status = threeWayVerify({
          ledger: entry.contentHash,
          ...(seen === undefined ? {} : { actual: seen.hash })
        });
        if (status !== "in-sync") {
          checks.push({ name: "drift", status: "warn", message: status, locator: entry.locator });
        }
      }
    }

    const lock = yield* Effect.result(Effect.scoped((yield* LedgerLock).acquire(scope, { waitMs: 0 })));
    if (lock._tag === "Success") {
      checks.push({ name: "lock", status: "ok", message: "the LedgerLock is free" });
    } else if (lock.failure._tag === "LedgerBusy") {
      const holder = lock.failure.holder === undefined ? "" : ` by ${lock.failure.holder}`;
      checks.push({ name: "lock", status: "warn", message: `the LedgerLock is held${holder}` });
    } else {
      checks.push({ name: "lock", status: "error", message: lock.failure.message });
    }

    const exists = new Map<string, boolean>();
    for (const agent of options.agents ?? (Object.keys(setup.adapters) as CodingAgentId[])) {
      const dialect = Object.hasOwn(setup.dialects, agent) ? setup.dialects[agent] : undefined;
      const hooks = yield* agentHooks(agent, setup);
      for (const hook of hooks.filter((found) => found.own)) {
        const program = hook.command.trim().split(/\s+/).map(unquote)[0] ?? "";
        if (program.startsWith("/") && !exists.has(program)) {
          const stat = yield* Effect.promise(() =>
            platform.fs.stat(program, { followSymlinks: true }).catch(() => undefined)
          );
          exists.set(program, stat !== undefined);
        }
        checks.push(...hookChecks(dialect, hook.locator, hook.hook, (target) => exists.get(target) ?? true));
      }
      checks.push(...duplicates(agent, hooks, options.markers ?? []));
    }
    return checks;
  });
}
