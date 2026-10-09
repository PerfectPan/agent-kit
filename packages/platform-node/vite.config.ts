import { fmt, lint } from "@perfectpan/lint-config/vite-plus";
import { defineConfig } from "vite-plus";

// it.effect is a test block that the standalone-expect rule does not know by default.
export default defineConfig({
  fmt,
  lint: {
    ...lint,
    rules: { ...lint.rules, "vitest/no-standalone-expect": ["error", { additionalTestBlockFunctions: ["it.effect"] }] }
  }
});
