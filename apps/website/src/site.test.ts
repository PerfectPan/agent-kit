import { expect, it } from "vite-plus/test";

import { normalizeBasePath } from "./lib/site.ts";

it.each([
  ["/agent-kit", "/agent-kit"],
  ["/agent-kit/", "/agent-kit"],
  ["/agent-kit///", "/agent-kit"],
  ["/agent-kit/pr-preview/pr-215/", "/agent-kit/pr-preview/pr-215"],
  ["/", ""],
  ["", ""]
])("normalizes the URL prefix %s without duplicating trailing slashes", (input, expected) => {
  expect(normalizeBasePath(input)).toBe(expected);
  expect(`${normalizeBasePath(input)}/docs`).toBe(`${expected}/docs`);
});
