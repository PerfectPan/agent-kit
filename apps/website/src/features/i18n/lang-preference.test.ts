import { expect, it } from "vite-plus/test";

import { languageFrom } from "./lang-preference.ts";

it("prefers a stored language over the browser", () => {
  expect(languageFrom("en", "zh-CN")).toBe("en");
  expect(languageFrom("zh", "en-US")).toBe("zh");
});

it("uses a zh* browser language when nothing is stored", () => {
  expect(languageFrom(null, "zh-CN")).toBe("zh");
  expect(languageFrom(null, "zh")).toBe("zh");
  expect(languageFrom("", "zh-TW")).toBe("zh");
});

it("falls back to English", () => {
  expect(languageFrom(null, "en-US")).toBe("en");
  expect(languageFrom(null, "")).toBe("en");
  expect(languageFrom("de", "fr")).toBe("en");
});
