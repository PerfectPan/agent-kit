import { fmt, lint } from "@perfectpan/lint-config/vite-plus";
import { defineConfig } from "vite-plus";

// it.effect, it.effect.each and it.live are test blocks that the standalone-expect rule does not know by default.
export default defineConfig({
  fmt,
  lint: {
    ...lint,
    rules: {
      ...lint.rules,
      "vitest/no-standalone-expect": [
        "error",
        { additionalTestBlockFunctions: ["it.effect", "it.effect.each", "it.live"] }
      ]
    }
  }
});
