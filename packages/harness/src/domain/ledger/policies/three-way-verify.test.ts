import { describe, expect, it } from "vitest";

import type { ContentHash } from "../value-objects/content-hash.js";
import { threeWayVerify } from "./three-way-verify.js";

const L: ContentHash = `sha256:${"1".repeat(64)}`;
const D: ContentHash = `sha256:${"2".repeat(64)}`;
const X: ContentHash = `sha256:${"3".repeat(64)}`;

describe("threeWayVerify", () => {
  it.each([
    ["actual = ledger ≠ desired", { ledger: L, actual: L, desired: D }, "outdated"],
    ["actual ≠ ledger, = desired", { ledger: L, actual: D, desired: D }, "ledger-behind"],
    ["actual differs from both", { ledger: L, actual: X, desired: D }, "user-modified"],
    ["in the ledger, missing on disk", { ledger: L, desired: D }, "deleted-externally"],
    ["not in the ledger, on disk = desired", { actual: D, desired: D }, "adoptable"],
    ["all three equal", { ledger: L, actual: L, desired: L }, "in-sync"],
    ["desired unknown, actual = ledger", { ledger: L, actual: L }, "in-sync"],
    ["desired unknown, actual ≠ ledger", { ledger: L, actual: X }, "user-modified"],
    ["not in the ledger, on disk ≠ desired", { actual: X, desired: D }, "unmanaged"],
    ["nothing recorded or on disk, desired", { desired: D }, "missing"],
    ["nothing anywhere", {}, "in-sync"]
  ] as const)("%s → %s", (_, input, status) => {
    expect(threeWayVerify(input)).toBe(status);
  });
});
