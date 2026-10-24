import { expect, it } from "vite-plus/test";

import { copy } from "./landing-copy.ts";

it("gives every landing string both languages", () => {
  for (const value of Object.values(copy)) {
    expect(Object.keys(value).sort()).toEqual(["en", "zh"]);
    expect(value.en.length).toBeGreaterThan(0);
    expect(value.zh.length).toBeGreaterThan(0);
  }
});
