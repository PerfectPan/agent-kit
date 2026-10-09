import { describe, expect, it } from "vite-plus/test";

import { basisMoved } from "./plan-basis.js";

describe("basisMoved", () => {
  const basedOn = { ledgerLineage: "lineage-1", ledgerRevision: 3 };

  it("is still on a different lineage or a different revision", () => {
    expect(basisMoved(basedOn, { lineage: "lineage-1", revision: 3 })).toBe(false);
    expect(basisMoved(basedOn, { lineage: "lineage-2", revision: 3 })).toBe(true);
    expect(basisMoved(basedOn, { lineage: "lineage-1", revision: 4 })).toBe(true);
  });
});
