import { fmt, lint } from "@perfectpan/lint-config/vite-plus";
import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt,
  // it.live is a test block that the standalone-expect rule does not know by default.
  lint: {
    ...lint,
    ignorePatterns: ["node_modules/**"],
    rules: { ...lint.rules, "vitest/no-standalone-expect": ["error", { additionalTestBlockFunctions: ["it.live"] }] }
  }
});
