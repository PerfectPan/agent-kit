import type { CodingAgentId } from "@rivus/agent-kit-catalog";
import {
  type ArtifactLocator,
  buildInstallPlan,
  type Bundle,
  checkLedgerVersion,
  CONFLICT_CHOICES,
  type ConflictChoice,
  type ContentHash,
  type DesiredArtifact,
  isLegacyArtifact,
  isWithin,
  Ledger,
  type LedgerEntry,
  type LedgerSnapshot,
  locatorKey,
  locatorsOverlap,
  type ObservedArtifact,
  type PreImage,
  type StepOutcome,
  threeWayVerify,
  type VerifyStatus
} from "@rivus/agent-kit-harness";
import { isEqual } from "es-toolkit";
import { describe, expect, it } from "vite-plus/test";

import { fixtureHash, type LedgerEntryFixture, ledgerFixture, ledgerSnapshotFixture } from "../src/ledger-fixture.js";

// Property-style checks of the plan and ledger invariants over seeded random scenarios. A failure names its seed;
// rerun a single seed by narrowing SEEDS.
const SEEDS = Array.from({ length: 400 }, (_, index) => index + 1);

/** mulberry32: a small seeded generator, so every scenario is reproducible from its seed. */
function generator(seed: number) {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const chance = (probability: number): boolean => next() < probability;
  const pick = <T>(values: readonly T[]): T => values[Math.floor(next() * values.length)] as T;
  const subset = <T>(values: readonly T[]): T[] => {
    const chosen = values.filter(() => chance(0.5));
    return chosen.length > 0 ? chosen : [pick(values)];
  };
  return { chance, pick, subset };
}

const HOME = "/u/me";
const OWNER = "app-a";
const OTHER = "app-b";
const MARKER = "legacy-marker";
const AGENTS: readonly CodingAgentId[] = ["claude-code", "codex", "grok"];
const ROOTS = [`${HOME}/.claude`, `${HOME}/.agents`];
const settings = `${HOME}/.claude/settings.json`;
const POOL: readonly ArtifactLocator[] = [
  { kind: "file", path: `${HOME}/.claude/skills/s1/SKILL.md` },
  { kind: "file", path: `${HOME}/.claude/skills/s2/SKILL.md` },
  { kind: "file", path: `${HOME}/.agents/skills/s3/SKILL.md` },
  { kind: "dir", path: `${HOME}/.claude/plugins/p1` },
  { kind: "json-entry", path: settings, pointer: "/hooks/Stop", member: "shim Stop" },
  { kind: "json-entry", path: settings, pointer: "/hooks/Stop", member: "old-shim Stop" },
  { kind: "json-entry", path: settings, pointer: "/hooks/SessionStart", member: "shim SessionStart" },
  { kind: "cli-registration", path: `${HOME}/.claude/plugins.json`, pointer: "p1@skills-dir" }
];
const CONTENTS: readonly ContentHash[] = ["c1", "c2", "c3", "c4"].map(fixtureHash);
const BUNDLE: Bundle = { owner: OWNER, version: "2.0.0", digest: "d", artifacts: [], legacyMarkers: [MARKER] };

interface Scenario {
  readonly ledger: Ledger;
  readonly agents: readonly CodingAgentId[];
  readonly desired: readonly DesiredArtifact[];
  readonly observed: readonly ObservedArtifact[];
  readonly choices: Readonly<Record<string, ConflictChoice>>;
}

function scenario(seed: number): Scenario {
  const { chance, pick, subset } = generator(seed);
  const agents = subset(AGENTS);
  const entries: LedgerEntryFixture[] = [];
  const desired: DesiredArtifact[] = [];
  const observed: ObservedArtifact[] = [];
  const choices: Record<string, ConflictChoice> = {};
  // Biased toward consistent states (recorded content still on disk, the owner's own entries), so that most plans
  // build and the apply paths get exercised, with every kind of drift and conflict still showing up.
  for (const locator of POOL) {
    const recorded = chance(0.5) ? pick(CONTENTS) : undefined;
    if (recorded !== undefined) {
      const owners = chance(0.8) ? [OWNER] : pick([[OTHER], [OWNER, OTHER]]);
      const preImage: PreImage = chance(0.3)
        ? { existed: true, hash: pick(CONTENTS), blobRef: "blob" }
        : { existed: false };
      entries.push({
        locator,
        owners,
        activeOwner: pick(owners),
        agents: subset(AGENTS),
        contentHash: recorded,
        preImage,
        entryRevision: Math.floor(seed % 5)
      });
    }
    const onDisk = recorded !== undefined && chance(0.7) ? recorded : chance(0.4) ? pick(CONTENTS) : undefined;
    const legacy = recorded === undefined && chance(0.1);
    if (onDisk !== undefined || legacy) {
      observed.push({
        locator,
        hash: legacy ? fixtureHash("legacy") : (onDisk ?? pick(CONTENTS)),
        ...(legacy ? { content: { type: "command", command: `run ${MARKER} hook` } } : {}),
        ...(chance(0.03) ? { managedBy: "chezmoi" } : {}),
        ...(chance(0.03) ? { symlinkTarget: "/dotfiles/target" } : {})
      });
    }
    if (chance(0.5)) {
      const hash = chance(0.5) ? (onDisk ?? recorded ?? pick(CONTENTS)) : pick(CONTENTS);
      for (const agent of subset(agents)) {
        desired.push({ agent, locator, content: hash, hash, strategy: "native-plugin" });
      }
    }
    if (chance(0.3)) {
      choices[locatorKey(locator)] = pick(["force", "adopt", "backup"] as const);
    }
  }
  return { ledger: ledgerFixture({ revision: 5, entries }), agents, desired, observed, choices };
}

function build(input: Scenario) {
  return buildInstallPlan(
    {
      planId: "plan",
      bundle: BUNDLE,
      target: { scope: "user", agents: input.agents, roots: ROOTS },
      desired: input.desired,
      choices: input.choices
    },
    input.ledger,
    input.observed
  );
}

const held = (entry: LedgerEntry | undefined): boolean => entry?.owners.includes(OWNER) === true;

/**
 * Collects broken properties as `seed N: what`, so that one assertion at the end reports every failing seed instead
 * of stopping at the first.
 */
function violations() {
  const found: string[] = [];
  const check = (seed: number, holds: boolean, what: string): void => {
    if (!holds) {
      found.push(`seed ${seed}: ${what}`);
    }
  };
  return { found, check };
}

/** A ledger that `restore` accepts again satisfies every ledger invariant. */
const valid = (ledger: Ledger): boolean => Ledger.restore(structuredClone(ledger.toSnapshot())).ok;

describe("InstallPlan invariants", () => {
  it("every step has its own locator, inside the roots, and removes only what the owner holds or left behind", () => {
    const { found, check } = violations();
    let plans = 0;
    for (const seed of SEEDS) {
      const input = scenario(seed);
      const result = build(input);
      if (!result.ok) {
        // Every generated scenario is well formed, so the factory may only stop at a conflict.
        check(seed, result.error._tag === "PlanConflict", `plan refused with ${JSON.stringify(result.error)}`);
        continue;
      }
      plans++;
      const steps = result.value.steps;
      const keys = steps.map((step) => locatorKey(step.locator));
      check(seed, new Set(keys).size === keys.length, "two steps share a locator");
      steps.forEach((step, index) => {
        const at = `${step.action} ${keys[index]}`;
        check(
          seed,
          ROOTS.some((root) => isWithin(step.locator.path, root)),
          `${at} is outside the roots`
        );
        check(
          seed,
          !steps.slice(index + 1).some((later) => locatorsOverlap(step.locator, later.locator)),
          `${at} overlaps a later step`
        );
        check(seed, step.action !== "conflict", `${at} is an unresolved conflict in a built plan`);
        const entry = input.ledger.entry(step.locator);
        if (step.action === "remove" && entry === undefined) {
          // Only what an older version left counts, judged from the observed content, not from the step's flag.
          const content = input.observed.find((seen) => locatorKey(seen.locator) === keys[index])?.content;
          check(seed, isLegacyArtifact([MARKER], content), `${at} removes what the owner never installed`);
        } else if (step.action === "remove") {
          check(seed, held(entry), `${at} removes what the owner does not hold`);
          const sole = entry?.owners.length === 1 && entry.agents.every((agent) => input.agents.includes(agent));
          check(
            seed,
            sole === (step.removal !== "release"),
            `${at} ${step.removal} although the owner ${sole ? "alone" : "not alone"} uses it`
          );
        }
        if (entry !== undefined && !held(entry)) {
          // Another owner's entry is only joined with identical content or taken over by force.
          check(seed, step.action === "adopt" || step.choice === "force", `${at} touches another owner's entry`);
        }
      });
    }
    expect(found).toEqual([]);
    expect(plans).toBeGreaterThan(100);
  });

  it("a rejected plan names only conflicts that no given choice resolves", () => {
    const { found, check } = violations();
    let conflicts = 0;
    for (const seed of SEEDS) {
      const input = scenario(seed);
      const result = build(input);
      if (result.ok || result.error._tag !== "PlanConflict") {
        continue;
      }
      conflicts++;
      for (const { step, choices } of result.error.conflicts) {
        const choice = input.choices[locatorKey(step.locator)];
        const allowed = step.conflict === undefined ? [] : CONFLICT_CHOICES[step.conflict];
        check(
          seed,
          choices.every((offered) => allowed.includes(offered)),
          `${step.conflict} offers ${choices.join(",")}`
        );
        if (step.conflict === "symlinked-target" && choices.length > 0) {
          // Adopting through a symlink is offered only where nothing has to be written.
          const writes = !("hash" in step.precondition && step.precondition.hash === step.desired?.hash);
          check(seed, !writes, "symlinked-target offers adopt although the step would write");
        }
        check(seed, choice === undefined || !choices.includes(choice), `${step.conflict} rejected despite ${choice}`);
      }
    }
    expect(found).toEqual([]);
    expect(conflicts).toBeGreaterThan(100);
  });
});

describe("Ledger invariants", () => {
  it("revisions strictly increase, entries keep an owner, and pending clears only once an outcome is known", () => {
    const { found, check } = violations();
    let applied = 0;
    for (const seed of SEEDS) {
      const input = scenario(seed);
      const result = build(input);
      if (!result.ok) {
        continue;
      }
      const { chance, pick } = generator(seed * 7919);
      const plan = result.value;
      const keys = plan.steps.map((step) => locatorKey(step.locator));
      const preImages = Object.fromEntries(
        plan.steps.flatMap((step) =>
          step.capturePreImage && "hash" in step.precondition
            ? [[locatorKey(step.locator), { existed: true, hash: step.precondition.hash, blobRef: "blob" } as const]]
            : []
        )
      );
      const begun = input.ledger.begin(plan, { at: "t1", toolVersion: "0.2.0", preImages });
      check(seed, begun.ok, "begin refused a fresh plan");
      if (!begun.ok) {
        continue;
      }
      applied++;
      const pending = begun.value.state;
      check(seed, pending.lineage === input.ledger.lineage, "begin changed the lineage");
      check(seed, pending.revision === input.ledger.revision + 1, "begin did not advance the revision by one");
      check(seed, isEqual(pending.entries(), input.ledger.entries()), "begin changed entries before acting");
      check(
        seed,
        isEqual(
          pending.pending.map((op) => locatorKey(op.locator)),
          keys
        ),
        "pending is not one op per step"
      );

      const outcomes: StepOutcome[] = plan.steps.flatMap((step) =>
        chance(0.15) ? [] : [{ locator: step.locator, status: pick(["done", "done", "skipped", "failed"] as const) }]
      );
      const status = new Map(outcomes.map((outcome) => [locatorKey(outcome.locator), outcome.status]));
      const completed = pending.complete(outcomes, { at: "t2" }).state;
      const unresolved = keys.filter((key) => status.get(key) === undefined || status.get(key) === "failed");
      check(
        seed,
        completed.revision === (unresolved.length === keys.length ? pending.revision : pending.revision + 1),
        `complete moved the revision to ${completed.revision}`
      );
      check(
        seed,
        isEqual(
          completed.pending.map((op) => locatorKey(op.locator)),
          unresolved
        ),
        "pending after complete is not exactly the failed or unreported steps"
      );
      for (const [index, step] of plan.steps.entries()) {
        const key = keys[index] ?? "";
        const after = completed.entry(step.locator);
        if (status.get(key) !== "done") {
          check(seed, isEqual(after, input.ledger.entry(step.locator)), `${key} changed without a done outcome`);
        } else if (step.action === "remove" && step.removal !== "release") {
          check(seed, after === undefined, `${key} is still recorded after its removal`);
        } else if (step.desired !== undefined) {
          check(seed, after?.contentHash === step.desired.hash, `${key} does not record the desired hash`);
          check(seed, after?.owners.includes(OWNER) === true, `${key} does not record the owner`);
        }
      }
      check(seed, valid(completed), "complete produced a ledger that breaks an invariant");

      // Probes favour the states a step leaves or starts from, so every resolution shows up.
      const recovered = completed.recover(
        completed.pending.flatMap((op) => {
          const states = [
            op.resultHash,
            op.preImage?.existed === true ? op.preImage.hash : undefined,
            "hash" in op.precondition ? op.precondition.hash : undefined,
            undefined,
            pick(CONTENTS)
          ];
          return chance(0.85) ? [{ locator: op.locator, hash: pick(states) }] : [];
        }),
        { at: "t3" }
      );
      const { state, resolutions } = recovered;
      for (const { locator, resolution } of resolutions) {
        const key = locatorKey(locator);
        const op = completed.pending.find((pending) => locatorKey(pending.locator) === key);
        const after = state.entry(locator);
        if (resolution !== "completed") {
          check(seed, isEqual(after, completed.entry(locator)), `${key} changed although ${resolution}`);
        } else if (op?.action === "remove" && op.removal !== "release") {
          check(seed, after === undefined, `${key} is still recorded after its ${op.removal} was recovered`);
        } else if (op?.resultHash !== undefined) {
          check(seed, after?.contentHash === op.resultHash, `${key} does not record the recovered content`);
        }
      }
      check(seed, state.pending.length === completed.pending.length - resolutions.length, "recover kept a probed op");
      check(
        seed,
        state.revision === (resolutions.length === 0 ? completed.revision : completed.revision + 1),
        `recover moved the revision to ${state.revision}`
      );
      check(seed, state.lineage === input.ledger.lineage, "recover changed the lineage");
      check(seed, valid(state), "recover produced a ledger that breaks an invariant");
    }
    expect(found).toEqual([]);
    expect(applied).toBeGreaterThan(100);
  });

  it("an unknown schema version is refused and the stored data is never cleared or rewritten", () => {
    const { found, check } = violations();
    const { pick } = generator(42);
    const versions: unknown[] = [0, 2, 3, 1.5, -1, "1", "2", null, undefined, true, {}, [1]];
    for (const seed of SEEDS) {
      const schemaVersion = pick(versions);
      const stored = {
        ...ledgerSnapshotFixture({ entries: scenario(seed).ledger.entries() }),
        schemaVersion
      } as unknown as LedgerSnapshot;
      const before = JSON.stringify(stored);
      const restored = Ledger.restore(stored);
      check(
        seed,
        !restored.ok && restored.error._tag === "LedgerVersionUnsupported",
        `version ${JSON.stringify(schemaVersion)} was not refused`
      );
      check(seed, !checkLedgerVersion(stored).ok, `checkLedgerVersion accepted ${JSON.stringify(schemaVersion)}`);
      check(seed, JSON.stringify(stored) === before, "the stored data changed");
    }
    expect(found).toEqual([]);
  });
});

describe("three-way verify", () => {
  // The table of plan 3.9, written out independently of the implementation.
  function oracle(ledger?: string, actual?: string, desired?: string): VerifyStatus {
    if (ledger !== undefined && actual === undefined) {
      return "deleted-externally";
    }
    if (ledger === undefined) {
      if (actual === undefined) {
        return desired === undefined ? "in-sync" : "missing";
      }
      return actual === desired ? "adoptable" : "unmanaged";
    }
    if (actual === ledger) {
      return desired !== undefined && desired !== ledger ? "outdated" : "in-sync";
    }
    return actual === desired ? "ledger-behind" : "user-modified";
  }

  it("matches every row of the table for every combination of ledger, disk and desired content", () => {
    const values = [undefined, ...CONTENTS.slice(0, 3)];
    for (const ledger of values) {
      for (const actual of values) {
        for (const desired of values) {
          expect({ ledger, actual, desired, status: threeWayVerify({ ledger, actual, desired }) }).toEqual({
            ledger,
            actual,
            desired,
            status: oracle(ledger, actual, desired)
          });
        }
      }
    }
  });
});
