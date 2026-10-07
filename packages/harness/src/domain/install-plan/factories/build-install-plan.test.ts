import type { Result } from "@rivus/agent-kit-catalog";
import { describe, expect, it } from "vitest";

import type { Bundle } from "../../bundle/value-objects/bundle.js";
import { Ledger } from "../../ledger/aggregate/ledger.js";
import type { ContentHash } from "../../ledger/value-objects/content-hash.js";
import type { LedgerEntry } from "../../ledger/value-objects/ledger-entry.js";
import type { InstallPlan } from "../aggregate/install-plan.js";
import { type ArtifactLocator, locatorKey } from "../value-objects/artifact-locator.js";
import type { ConflictChoice } from "../value-objects/conflict.js";
import type { DesiredArtifact } from "../value-objects/desired-artifact.js";
import type { InstallTarget } from "../value-objects/install-target.js";
import type { ObservedArtifact } from "../value-objects/observed-artifact.js";
import type { PlanStep } from "../value-objects/plan-step.js";
import { buildInstallPlan } from "./build-install-plan.js";

const HOME = "/u/me";
const OWNER = "agent-presence";
const h = (n: number): ContentHash => `sha256:${n.toString(16).padStart(64, "0")}`;
const file = (path: string): ArtifactLocator => ({ kind: "file", path: `${HOME}/${path}` });
const settingsHook = (event: string, command: string): ArtifactLocator => ({
  kind: "json-entry",
  path: `${HOME}/.claude/settings.json`,
  pointer: `/hooks/${event}`,
  member: command,
  memberIn: "hook-group"
});

const BUNDLE: Bundle = {
  owner: OWNER,
  version: "2.0.0",
  digest: "d2",
  artifacts: [],
  legacyMarkers: ["agent-presence hook", "@rivus/agent-presence"]
};
const TARGET: InstallTarget = { scope: "user", agents: ["claude-code"], roots: [`${HOME}/.claude`, `${HOME}/.agents`] };

function entry(locator: ArtifactLocator, overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    locator,
    owners: [OWNER],
    activeOwner: OWNER,
    agents: ["claude-code"],
    bundleVersion: "1.0.0",
    toolVersion: "0.1.0",
    contentHash: h(1),
    preImage: { existed: false },
    appliedAt: "2026-10-01T00:00:00.000Z",
    entryRevision: 1,
    ...overrides
  };
}

function ledger(entries: readonly LedgerEntry[] = []): Ledger {
  const restored = Ledger.restore({
    schemaVersion: 1,
    lineage: "lineage-1",
    revision: 3,
    entries: Object.fromEntries(entries.map((item) => [locatorKey(item.locator), item])),
    pending: []
  });
  if (!restored.ok) {
    throw new Error(JSON.stringify(restored.error));
  }
  return restored.value;
}

const want = (locator: ArtifactLocator, n: number, overrides: Partial<DesiredArtifact> = {}): DesiredArtifact => ({
  agent: "claude-code",
  locator,
  content: `content ${n}`,
  hash: h(n),
  strategy: "native-plugin",
  ...overrides
});

const seen = (locator: ArtifactLocator, n: number, overrides: Partial<ObservedArtifact> = {}): ObservedArtifact => ({
  locator,
  hash: h(n),
  ...overrides
});

function plan(input: {
  readonly desired?: readonly DesiredArtifact[];
  readonly ledger?: Ledger;
  readonly observed?: readonly ObservedArtifact[];
  readonly choices?: Readonly<Record<string, ConflictChoice>>;
  readonly target?: InstallTarget;
}): Result<InstallPlan, { readonly _tag: string }> {
  return buildInstallPlan(
    {
      planId: "plan-1",
      bundle: BUNDLE,
      target: input.target ?? TARGET,
      desired: input.desired ?? [],
      ...(input.choices === undefined ? {} : { choices: input.choices })
    },
    input.ledger ?? ledger(),
    input.observed ?? []
  );
}

function steps(result: Result<InstallPlan, { readonly _tag: string }>): readonly PlanStep[] {
  if (!result.ok) {
    throw new Error(`expected a plan, got ${JSON.stringify(result.error)}`);
  }
  return result.value.steps;
}

const stepAt = (all: readonly PlanStep[], locator: ArtifactLocator): PlanStep | undefined =>
  all.find((step) => locatorKey(step.locator) === locatorKey(locator));

describe("buildInstallPlan", () => {
  const skill = file(".claude/skills/presence/SKILL.md");
  const shim = file(".claude/skills/presence/hooks/hooks.json");

  it("creates what is missing, keeps what is in sync, and announces trust prompts only for new content", () => {
    const result = plan({
      desired: [want(skill, 2), want(shim, 3, { trust: "hook-review" })],
      ledger: ledger([entry(skill, { contentHash: h(2) })]),
      observed: [seen(skill, 2)]
    });
    expect(steps(result)).toEqual([
      {
        locator: shim,
        action: "create",
        agents: ["claude-code"],
        precondition: { absent: true },
        desired: { hash: h(3), content: "content 3" },
        strategy: "native-plugin",
        capturePreImage: false
      },
      expect.objectContaining({ locator: skill, action: "noop", precondition: { hash: h(2) } })
    ]);
    expect(result.ok && result.value.expectedTrustPrompts).toEqual([
      { agent: "claude-code", kind: "hook-review", locator: shim }
    ]);
    expect(result.ok && result.value.basedOn).toEqual({ ledgerLineage: "lineage-1", ledgerRevision: 3 });
  });

  it("updates an outdated artifact and takes the disk's content when the ledger is behind", () => {
    const behind = file(".claude/skills/other/SKILL.md");
    const all = steps(
      plan({
        desired: [want(skill, 2), want(behind, 5)],
        ledger: ledger([entry(skill), entry(behind)]),
        observed: [seen(skill, 1), seen(behind, 5)]
      })
    );
    expect(stepAt(all, skill)).toMatchObject({ action: "update", drift: "outdated", precondition: { hash: h(1) } });
    expect(stepAt(all, behind)).toMatchObject({ action: "noop", desired: { hash: h(5) } });
  });

  it("S32 (domain): rejects the whole plan on a conflict without a choice, and applies each allowed choice", () => {
    const foreign = file(".claude/skills/presence/extra.md");
    const unresolved = plan({ desired: [want(skill, 2), want(foreign, 3)], observed: [seen(foreign, 9)] });
    expect(unresolved).toEqual({
      ok: false,
      error: {
        _tag: "PlanConflict",
        planId: "plan-1",
        conflicts: [
          {
            step: expect.objectContaining({ locator: foreign, action: "conflict", conflict: "unmanaged-exists" }),
            choices: ["adopt", "backup"]
          }
        ]
      }
    });
    const key = locatorKey(foreign);
    const choose = (choice: ConflictChoice) =>
      plan({ desired: [want(foreign, 3)], observed: [seen(foreign, 9)], choices: { [key]: choice } });
    expect(steps(choose("adopt"))).toEqual([
      expect.objectContaining({
        action: "adopt",
        capturePreImage: false,
        conflict: "unmanaged-exists",
        choice: "adopt"
      })
    ]);
    expect(steps(choose("backup"))).toEqual([
      expect.objectContaining({ action: "adopt", capturePreImage: true, precondition: { hash: h(9) } })
    ]);
    expect(choose("force")).toMatchObject({ ok: false, error: { _tag: "PlanConflict" } });
  });

  it("asks before overwriting what the user changed, and overwrites only on force", () => {
    const input = { desired: [want(skill, 2)], ledger: ledger([entry(skill)]), observed: [seen(skill, 7)] };
    expect(plan(input)).toMatchObject({
      ok: false,
      error: { conflicts: [{ step: { conflict: "user-modified", drift: "user-modified" }, choices: ["force"] }] }
    });
    expect(steps(plan({ ...input, choices: { [locatorKey(skill)]: "force" } }))).toEqual([
      expect.objectContaining({ action: "update", precondition: { hash: h(7) }, choice: "force" })
    ]);
  });

  it("adopts identical content it did not record and keeps that content as the pre-image", () => {
    expect(steps(plan({ desired: [want(skill, 2)], observed: [seen(skill, 2)] }))).toEqual([
      expect.objectContaining({
        action: "adopt",
        drift: "adoptable",
        capturePreImage: true,
        precondition: { hash: h(2) }
      })
    ]);
  });

  it("re-creates an artifact deleted outside harness", () => {
    expect(steps(plan({ desired: [want(skill, 2)], ledger: ledger([entry(skill, { contentHash: h(2) })]) }))).toEqual([
      expect.objectContaining({ action: "create", drift: "deleted-externally", precondition: { absent: true } })
    ]);
  });

  it("never resolves a write at a dotfiles-managed or symlinked target, whatever the choice", () => {
    const managed = file(".claude/CLAUDE.md");
    const linked = file(".claude/skills/linked/SKILL.md");
    const result = plan({
      desired: [want(managed, 2), want(linked, 3)],
      observed: [seen(managed, 8, { managedBy: "chezmoi" }), seen(linked, 4, { symlinkTarget: "/dotfiles/skill.md" })],
      choices: { [locatorKey(managed)]: "force", [locatorKey(linked)]: "adopt" }
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        conflicts: [
          { step: { locator: managed, conflict: "dotfiles-managed" }, choices: [] },
          { step: { locator: linked, conflict: "symlinked-target" }, choices: [] }
        ]
      }
    });
  });

  it("leaves in-sync artifacts at dotfiles-managed paths alone and takes a symlink's content only on an explicit adopt", () => {
    const managed = file(".claude/CLAUDE.md");
    const linked = file(".claude/skills/linked/SKILL.md");
    const managedSeen = seen(managed, 2, { managedBy: "chezmoi" });
    const input = {
      desired: [want(managed, 2), want(linked, 3)],
      ledger: ledger([entry(managed, { contentHash: h(2) })]),
      observed: [managedSeen, seen(linked, 3, { symlinkTarget: "/dotfiles/skill.md" })]
    };
    expect(plan(input)).toMatchObject({
      ok: false,
      error: { conflicts: [{ step: { locator: linked, conflict: "symlinked-target" }, choices: ["adopt"] }] }
    });
    const all = steps(plan({ ...input, choices: { [locatorKey(linked)]: "adopt" } }));
    expect(all.map((step) => [step.locator, step.action, step.choice])).toEqual([
      [linked, "adopt", "adopt"],
      [managed, "noop", undefined]
    ]);
    expect(stepAt(all, linked)).toMatchObject({ precondition: { hash: h(3) }, desired: { hash: h(3) } });
    expect(
      plan({ ...input, observed: [managedSeen, seen(linked, 4, { symlinkTarget: "/dotfiles/skill.md" })] })
    ).toMatchObject({ ok: false, error: { conflicts: [{ step: { conflict: "symlinked-target" }, choices: [] }] } });
  });

  it("never blocks an uninstall at a dotfiles-managed or symlinked path: it keeps the file and notes why", () => {
    const managed = file(".claude/skills/a/SKILL.md");
    const linked = file(".claude/skills/b/SKILL.md");
    const oldHook = settingsHook("Stop", "npx --yes @rivus/agent-presence@0.9.0 hook --event Stop");
    const result = plan({
      ledger: ledger([entry(managed), entry(linked, { preImage: { existed: true, hash: h(20), blobRef: "blob-20" } })]),
      observed: [
        seen(managed, 1, { managedBy: "chezmoi" }),
        seen(linked, 1, { symlinkTarget: "/dotfiles/b.md" }),
        seen(oldHook, 12, { content: { command: oldHook.member ?? "" }, symlinkTarget: "/dotfiles/settings.json" })
      ],
      choices: { [locatorKey(managed)]: "force" }
    });
    const all = steps(result);
    expect(all.map((step) => [step.locator, step.action, step.removal, step.note])).toEqual([
      [managed, "remove", "keep", "dotfiles-managed"],
      [linked, "remove", "keep", "symlinked-target"],
      [oldHook, "noop", undefined, "symlinked-target"]
    ]);
    expect(result.ok && result.value.notes).toEqual([
      { locator: managed, note: "dotfiles-managed" },
      { locator: linked, note: "symlinked-target" },
      { locator: oldHook, note: "symlinked-target" }
    ]);
  });

  it("replaces what an older version of the owner installed instead of installing it twice (3.10)", () => {
    const extension = file(".agents/extensions/agent-presence.ts");
    const oldHook = settingsHook("Stop", "npx --yes @rivus/agent-presence@0.9.0 hook --source claude --event Stop");
    const userHook = settingsHook("Stop", "~/bin/notify.sh");
    const all = steps(
      plan({
        desired: [want(skill, 2), want(extension, 4)],
        observed: [
          seen(extension, 11, { content: "// @rivus/agent-presence pi extension\n" }),
          seen(oldHook, 12, {
            content: {
              type: "command",
              command: "npx --yes @rivus/agent-presence@0.9.0 hook --source claude --event Stop"
            }
          }),
          seen(userHook, 13, { content: { type: "command", command: "~/bin/notify.sh" } })
        ]
      })
    );
    expect(all.map((step) => [step.locator, step.action, step.legacy])).toEqual([
      [extension, "adopt", true],
      [skill, "create", undefined],
      [oldHook, "remove", true]
    ]);
    expect(stepAt(all, extension)).toMatchObject({ capturePreImage: false, desired: { hash: h(4) } });
    expect(stepAt(all, oldHook)).toMatchObject({ removal: "delete", precondition: { hash: h(12) }, agents: [] });
  });

  it("S33 (domain): uninstall removes or restores what the owner holds and keeps what the user changed", () => {
    const plain = file(".claude/skills/a/SKILL.md");
    const backedUp = file(".claude/skills/b/SKILL.md");
    const edited = file(".claude/skills/c/SKILL.md");
    const gone = file(".claude/skills/d/SKILL.md");
    const theirs = file(".claude/skills/e/SKILL.md");
    const preImage = { existed: true, hash: h(20), blobRef: "blob-20" } as const;
    const held = ledger([
      entry(plain),
      entry(backedUp, { preImage }),
      entry(edited),
      entry(gone),
      entry(theirs, { owners: ["other-app"], activeOwner: "other-app" })
    ]);
    const observed = [seen(plain, 1), seen(backedUp, 1), seen(edited, 6), seen(theirs, 1)];
    const all = steps(plan({ ledger: held, observed }));
    expect(all.map((step) => [step.locator.path, step.action, step.removal, step.drift])).toEqual([
      [plain.path, "remove", "delete", undefined],
      [backedUp.path, "remove", "restore-pre-image", undefined],
      [edited.path, "remove", "keep", "user-modified"],
      [gone.path, "remove", "delete", "deleted-externally"]
    ]);
    expect(stepAt(all, edited)).toMatchObject({ agents: [], precondition: { hash: h(6) } });
    expect(stepAt(all, gone)?.precondition).toEqual({ absent: true });
    const forced = steps(plan({ ledger: held, observed, choices: { [locatorKey(edited)]: "force" } }));
    expect(stepAt(forced, edited)).toMatchObject({ action: "remove", removal: "delete", precondition: { hash: h(6) } });
  });

  it("releases an artifact that other agents or owners still use, changing only the ledger", () => {
    const sharedByAgents = file(".agents/skills/presence/SKILL.md");
    const sharedByOwners = file(".agents/skills/common/SKILL.md");
    const all = steps(
      plan({
        ledger: ledger([
          entry(sharedByAgents, { agents: ["claude-code", "codex"] }),
          entry(sharedByOwners, { owners: [OWNER, "other-app"], activeOwner: "other-app" })
        ]),
        observed: [seen(sharedByAgents, 1), seen(sharedByOwners, 1)]
      })
    );
    expect(stepAt(all, sharedByAgents)).toEqual({
      locator: sharedByAgents,
      action: "remove",
      agents: ["codex"],
      removal: "release",
      capturePreImage: false,
      precondition: { ownedAt: 1 }
    });
    expect(stepAt(all, sharedByOwners)).toMatchObject({
      action: "remove",
      removal: "release",
      agents: ["claude-code"]
    });
  });

  it("joins another owner on identical content and conflicts on different content", () => {
    const theirs = entry(skill, { owners: ["other-app"], activeOwner: "other-app", agents: ["codex"] });
    const target = { ...TARGET, agents: ["claude-code", "codex"] };
    expect(
      steps(plan({ desired: [want(skill, 1)], ledger: ledger([theirs]), observed: [seen(skill, 1)], target }))
    ).toEqual([
      expect.objectContaining({ action: "adopt", agents: ["claude-code", "codex"], precondition: { hash: h(1) } })
    ]);
    const different = { desired: [want(skill, 2)], ledger: ledger([theirs]), observed: [seen(skill, 1)], target };
    expect(plan(different)).toMatchObject({ ok: false, error: { conflicts: [{ step: { conflict: "other-owner" } }] } });
    expect(steps(plan({ ...different, choices: { [locatorKey(skill)]: "force" } }))).toEqual([
      expect.objectContaining({ action: "update", choice: "force" })
    ]);
  });

  it("joins another owner only on its recorded content, never on a disk that already drifted from it", () => {
    const theirs = entry(skill, { owners: ["other-app"], activeOwner: "other-app", contentHash: h(1) });
    expect(plan({ desired: [want(skill, 2)], ledger: ledger([theirs]), observed: [seen(skill, 2)] })).toMatchObject({
      ok: false,
      error: { conflicts: [{ step: { conflict: "other-owner" }, choices: ["force"] }] }
    });
    const shared = entry(skill, { owners: [OWNER, "other-app"], activeOwner: "other-app", contentHash: h(1) });
    expect(plan({ desired: [want(skill, 2)], ledger: ledger([shared]), observed: [seen(skill, 2)] })).toMatchObject({
      ok: false,
      error: { conflicts: [{ step: { conflict: "other-owner" } }] }
    });
  });

  it("merges what several agents want at one locator and rejects different content there", () => {
    const target = { ...TARGET, agents: ["codex", "grok"] };
    const shared = file(".agents/skills/presence/SKILL.md");
    expect(
      steps(plan({ desired: [want(shared, 2, { agent: "grok" }), want(shared, 2, { agent: "codex" })], target }))
    ).toEqual([expect.objectContaining({ action: "create", agents: ["codex", "grok"] })]);
    expect(
      plan({ desired: [want(shared, 2, { agent: "grok" }), want(shared, 3, { agent: "codex" })], target })
    ).toEqual({
      ok: false,
      error: { _tag: "InvalidPlan", reason: "conflicting-desired", locator: shared }
    });
  });

  it("leaves the owner's artifacts of agents outside the plan alone", () => {
    expect(steps(plan({ ledger: ledger([entry(skill, { agents: ["codex"] })]), observed: [seen(skill, 1)] }))).toEqual(
      []
    );
  });

  it("rejects paths outside the roots, overlapping steps, and a ledger with pending operations", () => {
    expect(plan({ desired: [want(file(".bashrc"), 2)] })).toMatchObject({
      ok: false,
      error: { _tag: "InvalidPlan", reason: "outside-roots" }
    });
    const settings = file(".claude/settings.json");
    expect(plan({ desired: [want(settings, 2), want(settingsHook("Stop", "x"), 3)] })).toMatchObject({
      ok: false,
      error: { _tag: "InvalidPlan", reason: "overlapping-locators" }
    });
    const pending = Ledger.restore({
      ...ledger().toSnapshot(),
      pending: [
        {
          planId: "earlier",
          owner: OWNER,
          bundleVersion: "1.0.0",
          toolVersion: "0.1.0",
          locator: skill,
          action: "create",
          agents: ["claude-code"],
          precondition: { absent: true },
          resultHash: h(1),
          startedAt: "2026-10-01T00:00:00.000Z"
        }
      ]
    });
    expect(pending.ok && plan({ desired: [want(skill, 2)], ledger: pending.value })).toMatchObject({
      ok: false,
      error: { _tag: "PendingOperations" }
    });
  });

  it("writes before it removes: containers first, then entries and registrations; removals the other way round", () => {
    const dir = { kind: "dir", path: `${HOME}/.claude/skills/new` } as const;
    const registration = {
      kind: "cli-registration",
      path: `${HOME}/.claude/settings.json`,
      pointer: "presence@skills-dir"
    } as const;
    const oldDir = { kind: "dir", path: `${HOME}/.claude/skills/old` } as const;
    const oldRegistration = { kind: "cli-registration", path: `${HOME}/.claude/plugins.json`, pointer: "old" } as const;
    const all = steps(
      plan({
        desired: [want(registration, 2), want(dir, 3)],
        ledger: ledger([entry(oldDir), entry(oldRegistration)]),
        observed: [seen(oldDir, 1), seen(oldRegistration, 1)]
      })
    );
    expect(all.map((step) => [step.action, step.locator.kind])).toEqual([
      ["create", "dir"],
      ["create", "cli-registration"],
      ["remove", "cli-registration"],
      ["remove", "dir"]
    ]);
  });
});
