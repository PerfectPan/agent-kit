import { expect, it } from "vite-plus/test";

import { i18nSearchData } from "./search-export.ts";

it("returns the per-locale map", () => {
  const data = { en: { type: "advanced" }, zh: { type: "advanced" } };
  expect(i18nSearchData({ type: "i18n", data })).toBe(data);
});

it("rejects a single-index export", () => {
  expect(() => i18nSearchData({ type: "advanced" })).toThrow(/advanced/);
  expect(() => i18nSearchData(null)).toThrow(/object/);
});
