import { readFileSync } from "node:fs";

import { defineConfig, type UserConfig } from "tsdown";

const manifest = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8")) as {
  version: string;
  exports: Record<string, unknown>;
};

// One entry per subpath export: "./transcript/usage" builds src/transcript/usage.ts into dist/transcript/usage.js.
const entry = Object.fromEntries(
  Object.keys(manifest.exports)
    .filter((subpath) => subpath !== "./package.json")
    .map((subpath) => [subpath.slice(2), `./src/${subpath.slice(2)}.ts`])
);

// The zero-dependency entries load on their own where a host cannot install dependencies, so their built code and
// declarations import nothing. tsdown bundles zod/mini into these three; every other entry keeps it as an external
// import, and check-dist fails if a zero-dependency entry still imports anything.
const ZERO_DEPENDENCY_ENTRIES = ["cost", "harness/events", "transcript/usage"];

const shared = (entryNames: string[]): UserConfig => ({
  entry: Object.fromEntries(entryNames.map((name) => [name, `./src/${name}.ts`])),
  format: "esm",
  platform: "neutral",
  // The harness ledger records the kit version that wrote each entry.
  define: { __AGENT_KIT_VERSION__: JSON.stringify(manifest.version) },
  // TypeScript 7 has no stable compiler API, and the tsgo generator only emits files inside this package. Oxc emits
  // declarations for the internal packages' sources, which enable isolatedDeclarations so that Oxc output is exact.
  dts: { generator: "oxc" }
});

export default defineConfig([
  {
    ...shared(ZERO_DEPENDENCY_ENTRIES),
    // alwaysBundle matches whole import specifiers, so the pattern covers the `zod/mini` subpath.
    deps: { neverBundle: [/^node:/], alwaysBundle: [/^zod(\/|$)/], dts: { alwaysBundle: [/^zod(\/|$)/] } }
  },
  {
    ...shared(Object.keys(entry).filter((name) => !ZERO_DEPENDENCY_ENTRIES.includes(name))),
    // The internal packages are devDependencies, so they are bundled; dependencies, peers and node:* stay external.
    deps: { neverBundle: [/^node:/] }
  }
]);
