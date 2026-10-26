import { expect, it } from "vite-plus/test";

import { docsUrl, slugsFromSplat } from "./docs-path.ts";

it("splits a splat and drops empty parts", () => {
  expect(slugsFromSplat(undefined)).toEqual([]);
  expect(slugsFromSplat("")).toEqual([]);
  expect(slugsFromSplat("installation")).toEqual(["installation"]);
  expect(slugsFromSplat("api/sessions")).toEqual(["api", "sessions"]);
  expect(slugsFromSplat("/api/sessions/")).toEqual(["api", "sessions"]);
});

it("builds a language-free docs pathname", () => {
  expect(docsUrl([])).toBe("/docs");
  expect(docsUrl(["installation"])).toBe("/docs/installation");
  expect(docsUrl(["api", "sessions"])).toBe("/docs/api/sessions");
});
