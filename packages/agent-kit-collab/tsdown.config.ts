import { readFileSync } from "node:fs";

import { defineConfig } from "tsdown";

const manifest = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8")) as {
  exports: Record<string, unknown>;
};

// One entry per subpath export: "./lease" builds src/lease/public.ts into dist/lease.js.
const entry = Object.fromEntries(
  Object.keys(manifest.exports)
    .filter((subpath) => subpath !== "./package.json")
    .map((subpath) => [subpath.slice(2), `./src/${subpath.slice(2)}/public.ts`])
);

export default defineConfig({
  entry,
  format: "esm",
  platform: "neutral",
  // Dependencies and peers stay external: @rivus/agent-kit and effect are peers, so the host's single copy of each
  // serves this package too.
  deps: { neverBundle: [/^node:/] },
  dts: { generator: "oxc" }
});
