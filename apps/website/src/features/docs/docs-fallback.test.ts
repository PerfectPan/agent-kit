import { expect, it } from "vite-plus/test";

import { englishFallback } from "./docs-fallback.ts";

it("flags a Chinese request that resolved to an English file", () => {
  expect(englishFallback("zh", "en/connection/discovery.mdx")).toBe(true);
  expect(englishFallback("zh", "connection/discovery.mdx")).toBe(true);
  expect(englishFallback("zh", "zh/connection/discovery.mdx")).toBe(false);
  expect(englishFallback("en", "en/index.mdx")).toBe(false);
});
