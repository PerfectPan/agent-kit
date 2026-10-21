import type { ContentHash } from "../../ledger/value-objects/content-hash.js";
import type { PreImage } from "../../ledger/value-objects/pre-image.js";
import { describe, expect, it } from "vite-plus/test";
import { PlanStep, type PlanStepSnapshot } from "./plan-step.js";

const hash = (n: number): ContentHash => `sha256:${n.toString(16).padStart(64, "0")}`;

const write = (overrides: Partial<PlanStepSnapshot> = {}): PlanStepSnapshot => ({
  locator: { kind: "file", path: "/u/me/x" },
  action: "update",
  agents: ["claude-code"],
  precondition: { hash: hash(1) },
  desired: { hash: hash(2), content: "new text" },
  capturePreImage: false,
  ...overrides
});

const remove = (removal: PlanStepSnapshot["removal"]): PlanStepSnapshot =>
  write({ action: "remove", desired: undefined, agents: [], precondition: { hash: hash(2) }, removal });

describe("contentAfterStep", () => {
  it("leaves the desired content of a non-removal", () => {
    expect(PlanStep.contentAfter(write(), undefined)).toEqual({ desired: "new text" });
    expect(PlanStep.contentAfter(write({ desired: undefined, action: "noop" }), undefined)).toBeUndefined();
  });

  it("restores a pre-image that existed, named by blob ref, and leaves nothing otherwise", () => {
    const preImage: PreImage = { existed: true, hash: hash(3), blobRef: "blob-1" };
    expect(PlanStep.contentAfter(remove("restore-pre-image"), preImage)).toEqual({ preImage: "blob-1" });
    expect(PlanStep.contentAfter(remove("restore-pre-image"), { existed: false })).toBeUndefined();
    expect(PlanStep.contentAfter(remove("delete"), preImage)).toBeUndefined();
    expect(PlanStep.contentAfter(remove("release"), preImage)).toBeUndefined();
    expect(PlanStep.contentAfter(remove("keep"), preImage)).toBeUndefined();
  });
});
