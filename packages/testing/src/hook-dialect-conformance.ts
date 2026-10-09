import type { CodingAgentId } from "@rivus/agent-kit-catalog";
import {
  builtinHookDialects,
  type HookDialect,
  type HookEventSpec,
  type HookOutput,
  type LifecycleEvent,
  type LifecycleMapping,
  readHookEvent
} from "@rivus/agent-kit-harness";
import { isEqual, isPlainObject } from "es-toolkit";

import { check, type ConformanceCheck } from "./session-adapter-conformance.js";

/** One scrubbed payload of an agent and the LifecycleEvent it must read as. */
export interface HookDialectSample {
  readonly name: string;
  readonly payload: unknown;
  /** The hook process's whole environment; defaults to empty. */
  readonly env?: Readonly<Record<string, string>>;
  /** The agent the hook was registered for; defaults to the dialect's agent. Sniffing may name another. */
  readonly declaredAgent?: CodingAgentId;
  readonly expected: LifecycleEvent;
}

export interface HookDialectFixtures {
  /** At least one sample per event in `dialect.events`. */
  readonly samples: readonly HookDialectSample[];
}

const PHASES = new Set(["start", "activity", "blocked", "finish", "unknown"]);
const SCOPES = new Set(["session", "turn"]);
const OUTCOMES = new Set(["completed", "failed", "cancelled"]);
const BLOCKERS = new Set(["permission", "question", "elicitation"]);
const OUTPUT_KEYS = ["emptyStdout", "invalidStdout", "exitCode2", "otherExitCodes"] as const;

/** Payloads that every dialect must read as phase `unknown` without throwing. */
function oddPayloads(dialect: HookDialect): unknown[] {
  const eventPaths = dialect.fields.event.paths ?? [];
  const at = (path: readonly string[], value: unknown): unknown =>
    path.reduceRight<unknown>((inner, key) => ({ [key]: inner }), value);
  return [
    undefined,
    null,
    0,
    "SessionStart",
    [],
    {},
    [{ type: "x" }],
    ...eventPaths.flatMap((path) =>
      ["constructor", "__proto__", "toString", "no-such-event", 42, { nested: true }, ""].map((name) => at(path, name))
    )
  ];
}

/** Each mapping of an event; `unknown` is legitimate for a switch's fallback and for a gate kept for its rules. */
function mappings(spec: HookEventSpec): { label: string; mapping: LifecycleMapping; fallback: boolean }[] {
  if (!("cases" in spec.lifecycle)) {
    return [{ label: "", mapping: spec.lifecycle, fallback: spec.gate === true }];
  }
  return [
    ...Object.entries(spec.lifecycle.cases).map(([value, mapping]) => ({
      label: ` (${value})`,
      mapping,
      fallback: false
    })),
    { label: " (otherwise)", mapping: spec.lifecycle.otherwise, fallback: true }
  ];
}

function mappingProblem(mapping: LifecycleMapping, fallback: boolean): string | undefined {
  if (!PHASES.has(mapping.phase) || (!fallback && mapping.phase === "unknown")) {
    return `phase ${String(mapping.phase)}`;
  }
  if (mapping.scope !== undefined && !SCOPES.has(mapping.scope)) {
    return `scope ${String(mapping.scope)}`;
  }
  if (mapping.outcome !== undefined && (mapping.phase !== "finish" || !OUTCOMES.has(mapping.outcome))) {
    return `outcome ${String(mapping.outcome)} on phase ${mapping.phase}`;
  }
  if (mapping.blocker !== undefined && (mapping.phase !== "blocked" || !BLOCKERS.has(mapping.blocker))) {
    return `blocker ${String(mapping.blocker)} on phase ${mapping.phase}`;
  }
  return undefined;
}

function outputProblem(output: HookOutput): string | undefined {
  if (OUTPUT_KEYS.some((key) => typeof output[key] !== "string")) {
    return "does not say what every exit code and stdout shape does";
  }
  if (output.passThrough === "") {
    return output.emptyStdout === "proceed"
      ? undefined
      : "needs a non-empty passThrough, empty stdout does not proceed";
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(output.passThrough);
  } catch {
    return `passThrough ${output.passThrough} is not JSON`;
  }
  if (!isPlainObject(parsed)) {
    return `passThrough ${output.passThrough} is not a JSON object`;
  }
  const unknown = Object.keys(parsed).filter((key) => output.fields !== undefined && !output.fields.includes(key));
  return unknown.length === 0 ? undefined : `passThrough uses fields the event does not accept: ${unknown.join(", ")}`;
}

/**
 * The checks every hook dialect must pass, independent of a test runner: wire each into the runner, for example
 * `for (const { name, run } of hookDialectConformance(dialect, fixtures)) it(name, run)`. Samples are read through
 * `readHookEvent` with this dialect merged over the built-in ones, so sniffing to another agent works as in use.
 */
export function hookDialectConformance(dialect: HookDialect, fixtures: HookDialectFixtures): ConformanceCheck[] {
  const adapters = { ...builtinHookDialects, [dialect.agent]: dialect };
  const read = (agent: CodingAgentId, payload: unknown, env: Readonly<Record<string, string>> = {}) =>
    readHookEvent(agent, payload, env, { adapters });
  const events = Object.entries(dialect.events);

  return [
    {
      name: "declares harness-v1 and how its hooks are delivered",
      run: async () => {
        // A conformance suite judges the dialect object as given, and a JS adapter can author one that ignores
        // HookDialect, so this comparison checks at runtime what the type only promises.
        // oxlint-disable-next-line no-unnecessary-condition
        check(dialect.specificationVersion === "harness-v1", `specificationVersion ${dialect.specificationVersion}`);
        check(dialect.agent !== "", "names no agent");
        check(events.length > 0, "maps no event");
        if (dialect.delivery === "command") {
          const unit = dialect.timeout?.unit;
          check(unit === "seconds" || unit === "milliseconds", "a command dialect needs a timeout unit");
          for (const [name, spec] of events) {
            check((spec.output ?? dialect.output) !== undefined, `${name}: no output rules`);
          }
        } else {
          // Same as above: the narrowed type only holds for a dialect authored against HookDialect.
          // oxlint-disable-next-line no-unnecessary-condition
          check(dialect.delivery === "plugin", `delivery ${String(dialect.delivery)}`);
          check(dialect.timeout === undefined, "an in-process plugin has no hook timeout");
        }
      }
    },
    {
      name: "maps every event to a phase",
      run: async () => {
        for (const [name, spec] of events) {
          for (const { label, mapping, fallback } of mappings(spec)) {
            const problem = mappingProblem(mapping, fallback);
            check(problem === undefined, `${name}${label}: ${problem ?? ""}`);
          }
        }
      }
    },
    {
      name: "declares a response format for every gate event and every output rule",
      run: async () => {
        for (const [name, spec] of events) {
          if (spec.gate === true) {
            check(spec.output !== undefined, `${name} is a gate but declares no response format of its own`);
          }
        }
        for (const [name, output] of [
          ["the dialect", dialect.output],
          ...events.map(([event, spec]) => [event, spec.output] as const)
        ] as const) {
          const problem = output === undefined ? undefined : outputProblem(output);
          check(problem === undefined, `${name}: ${problem ?? ""}`);
        }
      }
    },
    {
      name: "renames foreign events onto its own events",
      run: async () => {
        for (const foreign of dialect.runsHooksOf ?? []) {
          check(foreign.agent !== dialect.agent, "runs its own hooks as foreign hooks");
          for (const [from, to] of Object.entries(foreign.events)) {
            check(Object.hasOwn(dialect.events, to), `${foreign.agent} ${from} renames to unmapped event ${to}`);
          }
        }
      }
    },
    {
      name: "has a sample for every event",
      run: async () => {
        const sampled = new Set(fixtures.samples.map((sample) => sample.expected.nativeEvent));
        const missing = events
          .filter(([name, spec]) => ![name, ...(spec.aliases ?? [])].some((spelling) => sampled.has(spelling)))
          .map(([name]) => name);
        check(missing.length === 0, `no sample for ${missing.join(", ")}`);
      }
    },
    {
      name: "reads every sample to the expected LifecycleEvent",
      run: async () => {
        for (const sample of fixtures.samples) {
          const actual = read(sample.declaredAgent ?? dialect.agent, sample.payload, sample.env);
          check(
            isEqual(actual, sample.expected),
            `${sample.name}: read ${JSON.stringify(actual)}, expected ${JSON.stringify(sample.expected)}`
          );
        }
      }
    },
    {
      name: "reads odd payloads as phase unknown without throwing",
      run: async () => {
        for (const payload of oddPayloads(dialect)) {
          const event = read(dialect.agent, payload);
          check(
            event.phase === "unknown" && typeof event.nativeEvent === "string",
            // JSON.stringify's declared return hides that an odd payload can stringify to undefined.
            `${(JSON.stringify(payload) as string | undefined) ?? String(payload)} read as ${JSON.stringify(event)}`
          );
        }
      }
    }
  ];
}
