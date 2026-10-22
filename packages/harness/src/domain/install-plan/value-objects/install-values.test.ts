import { describe, expect, it } from "vite-plus/test";

import { ArtifactLocator } from "./artifact-locator.js";
import { Conflict } from "./conflict.js";
import { InstallTarget } from "./install-target.js";
import { PlanBasis } from "./plan-basis.js";
import { PlanStep, type PlanStepSnapshot } from "./plan-step.js";
import { Precondition } from "./precondition.js";

const hash = `sha256:${"1".repeat(64)}` as const;
const stepInput = (): PlanStepSnapshot => ({
  locator: { kind: "file", path: "/u/example/hook" },
  action: "create",
  agents: ["example"],
  precondition: { absent: true },
  desired: { hash, content: { nested: ["original"] } },
  capturePreImage: false
});

describe("install value objects", () => {
  it("copies a valid step and its descendants before freezing, keeping a plain snapshot", () => {
    const input = stepInput();
    const result = PlanStep.restore(input);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error);
    }
    const step = result.value;
    expect(step).toBeInstanceOf(PlanStep);
    expect(step.toSnapshot()).toEqual(input);
    expect(Object.getPrototypeOf(step.toSnapshot())).toBe(Object.prototype);
    expect(Object.isFrozen(input.locator)).toBe(false);
    expect(Object.isFrozen(input.agents)).toBe(false);
    expect(Object.isFrozen(input.desired?.content)).toBe(false);
    expect(Object.isFrozen(step.toSnapshot().desired?.content)).toBe(true);
    expect(step.toSnapshot().desired?.content).not.toBe(input.desired?.content);
    expect(step.key()).toBe('["/u/example/hook"]');
    expect(step.touchesDisk()).toBe(true);
    expect(step.contentAfter(undefined)).toEqual({ desired: { nested: ["original"] } });
  });

  it("rejects locator and step invariants without freezing rejected input", () => {
    const input = { ...stepInput(), locator: { kind: "file" as const, path: "relative" }, desired: undefined };
    expect(PlanStep.restore(input)).toEqual({ ok: false, error: "path is not absolute and normalized" });
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(input.locator)).toBe(false);
    expect(PlanStep.restore({ ...stepInput(), desired: undefined })).toEqual({
      ok: false,
      error: "create without desired content"
    });
    const preconditionInput = { ownedAt: 1 };
    const condition = Precondition.restore(preconditionInput);
    expect(condition.ok && condition.value.toSnapshot()).toEqual(preconditionInput);
    expect(Object.isFrozen(preconditionInput)).toBe(false);
    expect(Precondition.restore({ ownedAt: -1 })).toEqual({ ok: false, error: "an invalid precondition" });
    expect(Precondition.restore({ hash: "sha256:bad" })).toEqual({ ok: false, error: "an invalid precondition" });
  });

  it("keeps locator identity, containment and closed conflict choices on their values", () => {
    const input = stepInput().locator;
    const locator = ArtifactLocator.restore(input);
    if (!locator.ok) {
      throw new Error(locator.error);
    }
    expect(locator.value.key()).toBe('["/u/example/hook"]');
    expect(locator.value.overlaps({ kind: "dir", path: "/u/example" })).toBe(true);
    expect(locator.value.overlaps({ kind: "file", path: "/u/elsewhere" })).toBe(false);
    expect(locator.value.toSnapshot()).toEqual(input);
    expect(Object.isFrozen(input)).toBe(false);
    const targetInput = { scope: "user" as const, agents: ["example"], roots: ["/u/example"] };
    const target = InstallTarget.restore(targetInput);
    expect(target.contains(input)).toBe(true);
    expect(target.contains({ kind: "file", path: "/u/example-other/hook" })).toBe(false);
    expect(Object.isFrozen(targetInput.roots)).toBe(false);
    expect(Object.isFrozen(target.toSnapshot().roots)).toBe(true);
    expect(Conflict.restore("unmanaged-exists").choices()).toEqual(["adopt", "backup"]);
    expect(Conflict.restore("dotfiles-managed").choices()).toEqual([]);
    expect(Object.isFrozen(Conflict.restore("unmanaged-exists").choices())).toBe(true);
    expect(Conflict.restore("other-owner").toSnapshot()).toBe("other-owner");
    const basisInput = { ledgerLineage: "lineage", ledgerRevision: 0 };
    expect(PlanBasis.restore(basisInput).toSnapshot()).toEqual(basisInput);
    expect(Object.isFrozen(basisInput)).toBe(false);
  });
});
