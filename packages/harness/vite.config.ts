import { fmt, lint } from "@perfectpan/lint-config/vite-plus";
import { defineConfig } from "vite-plus";

import { withBoundaryLint } from "../../infra/architecture/lint.ts";

export default defineConfig({
  fmt,
  lint: withBoundaryLint(
    {
      ...lint,
      // it.effect, it.effect.each and it.live are test blocks that the standalone-expect rule does not know by default.
      rules: {
        ...lint.rules,
        "vitest/no-standalone-expect": [
          "error",
          { additionalTestBlockFunctions: ["it.effect", "it.effect.each", "it.live"] }
        ]
      }
    },
    import.meta.url
  )
});
