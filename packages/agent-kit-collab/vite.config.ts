import { readFileSync } from "node:fs";

import { fmt, lint } from "@perfectpan/lint-config/vite-plus";
import { defineConfig } from "vite-plus";

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
  // The generated changelogs are release output, not repository sources.
  fmt: { ...fmt, ignorePatterns: ["CHANGELOG.*"] },
  lint: {
    ...lint,
    ignorePatterns: ["dist/**"],
    // it.effect and it.live are test blocks that the standalone-expect rule does not know by default.
    rules: {
      ...lint.rules,
      "vitest/no-standalone-expect": ["error", { additionalTestBlockFunctions: ["it.effect", "it.live"] }]
    }
  },
  pack: {
    entry,
    format: "esm",
    platform: "neutral",
    // Dependencies and peers stay external: @rivus/agent-kit and effect are peers, so the host's single copy of each
    // serves this package too.
    deps: { neverBundle: [/^node:/] },
    dts: { generator: "oxc" }
  }
});
