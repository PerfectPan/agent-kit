import type { ContentHash } from "../../ledger/value-objects/content-hash.js";
import type { PreImage } from "../../ledger/value-objects/pre-image.js";
import { describe, expect, it } from "vite-plus/test";
import type { PlanStep } from "./plan-step.js";
import { contentAfterStep } from "./content-after.js";

const hash = (n: number): ContentHash => `sha256:${n.toString(16).padStart(64, "0")}`;

const write = (overrides: Partial<PlanStep> = {}): PlanStep => ({
  locator: { kind: "file", path: "/u/me/x" },
  action: "update",
  agents: ["claude-code"],
  precondition: { hash: hash(1) },
  desired: { hash: hash(2), content: "new text" },
  capturePreImage: false,
  ...overrides
});

const remove = (removal: PlanStep["removal"]): PlanStep =>
  write({ action: "remove", desired: undefined, agents: [], precondition: { hash: hash(2) }, removal });

describe("contentAfterStep", () => {
  it("leaves the desired content of a non-removal", () => {
    expect(contentAfterStep(write(), undefined)).toEqual({ desired: "new text" });
    expect(contentAfterStep(write({ desired: undefined, action: "noop" }), undefined)).toBeUndefined();
  });

  it("restores a pre-image that existed, named by blob ref, and leaves nothing otherwise", () => {
    const preImage: PreImage = { existed: true, hash: hash(3), blobRef: "blob-1" };
    expect(contentAfterStep(remove("restore-pre-image"), preImage)).toEqual({ preImage: "blob-1" });
    expect(contentAfterStep(remove("restore-pre-image"), { existed: false })).toBeUndefined();
    expect(contentAfterStep(remove("delete"), preImage)).toBeUndefined();
    expect(contentAfterStep(remove("release"), preImage)).toBeUndefined();
    expect(contentAfterStep(remove("keep"), preImage)).toBeUndefined();
  });
});
