import { readFileSync } from "node:fs";

import { defineConfig } from "tsdown";

const manifest = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8")) as {
  exports: Record<string, unknown>;
};

// One entry per subpath export: "./transcript/usage" builds src/transcript/usage.ts into dist/transcript/usage.js.
const entry = Object.fromEntries(
  Object.keys(manifest.exports)
    .filter((subpath) => subpath !== "./package.json")
    .map((subpath) => [subpath.slice(2), `./src/${subpath.slice(2)}.ts`])
);

export default defineConfig({
  entry,
  format: "esm",
  platform: "neutral",
  // The internal packages are devDependencies, so they are bundled; dependencies, peers and node:* stay external.
  deps: { neverBundle: [/^node:/] },
  // TypeScript 7 has no stable compiler API, and the tsgo generator only emits files inside this package. Oxc emits
  // declarations for the internal packages' sources, which enable isolatedDeclarations so that Oxc output is exact.
  dts: { generator: "oxc" }
});
