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

// `/lease` loads the same chunk as `/process-lock`. Bundling every zod import would pull `/lease`'s own schemas in
// too. Matching the importer inlines zod/mini only for the process-lock sources, which is what that chunk contains;
// `/lease` keeps importing zod/mini, so zod stays a dependency.
const bundleProcessLockZod = (id: string, importer: string | undefined): boolean =>
  /^zod(\/|$)/.test(id) && importer?.includes("/process-lock/") === true;

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
    // serves this package too. zod/mini is bundled only into the process-lock chunk (see bundleProcessLockZod).
    deps: { neverBundle: [/^node:/], alwaysBundle: bundleProcessLockZod, dts: { alwaysBundle: bundleProcessLockZod } },
    dts: { generator: "oxc" }
  }
});
