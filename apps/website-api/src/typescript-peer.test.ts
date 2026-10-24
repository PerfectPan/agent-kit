import { createRequire } from "node:module";

import { expect, it } from "vite-plus/test";

const require = createRequire(import.meta.url);
const typescript = require("typescript") as { readonly version: string };

it("resolves the TypeDoc peer to TypeScript 6", () => {
  expect(typescript.version.startsWith("6.")).toBe(true);
});
