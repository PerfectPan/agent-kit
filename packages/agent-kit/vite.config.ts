import { readFileSync } from "node:fs";

import { fmt, lint } from "@perfectpan/lint-config/vite-plus";
import { defineConfig } from "vite-plus";
import type { PackUserConfig } from "vite-plus/pack";

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
// declarations import nothing. The packer bundles zod/mini into these three, and check-dist fails if one of them
// still imports anything.
const ZERO_DEPENDENCY_ENTRIES = ["cost", "harness/events", "transcript/usage"];

// `zod/mini` is bundled only when the importing file is the Node platform. That platform is one chunk, loaded by
// `/node` and `/node/effect` and by nothing else, so the other entries of this pack keep importing zod/mini and zod
// stays a dependency. Matching the importer, rather than every entry, keeps `/node/effect` on the shared Effect chunk.
const bundlePlatformZod = (id: string, importer: string | undefined): boolean =>
  /^zod(\/|$)/.test(id) && importer?.includes("/platform-node/") === true;

const shared = (entryNames: string[]): PackUserConfig => ({
  entry: Object.fromEntries(entryNames.map((name) => [name, `./src/${name}.ts`])),
  format: "esm",
  platform: "neutral",
  // The harness ledger records the kit version that wrote each entry.
  define: { __AGENT_KIT_VERSION__: JSON.stringify(manifest.version) },
  // TypeScript 7 has no stable compiler API, and the tsgo generator only emits files inside this package. Oxc emits
  // declarations for the internal packages' sources, which enable isolatedDeclarations so that Oxc output is exact.
  dts: { generator: "oxc" }
});

export default defineConfig({
  // The generated changelog is release output, not a repository source; dist is build output.
  fmt: { ...fmt, ignorePatterns: ["CHANGELOG.*"] },
  lint: { ...lint, ignorePatterns: ["dist/**"] },
  // One pack per zero-dependency entry: sharing a pack would let the bundler put zod/mini into a common chunk the
  // entries import, and the built entry files must inline it instead.
  pack: [
    ...ZERO_DEPENDENCY_ENTRIES.map((name): PackUserConfig => ({
      ...shared([name]),
      // alwaysBundle matches whole import specifiers, so the pattern covers the `zod/mini` subpath.
      deps: { neverBundle: [/^node:/], alwaysBundle: [/^zod(\/|$)/], dts: { alwaysBundle: [/^zod(\/|$)/] } }
    })),
    {
      ...shared(Object.keys(entry).filter((name) => !ZERO_DEPENDENCY_ENTRIES.includes(name))),
      // The internal packages are devDependencies, so they are bundled; dependencies, peers and node:* stay external.
      // zod/mini is the exception for the Node platform chunk (see bundlePlatformZod).
      deps: {
        neverBundle: [/^node:/],
        alwaysBundle: bundlePlatformZod,
        dts: { alwaysBundle: bundlePlatformZod }
      }
    }
  ]
});
