import { fmt, lint } from "@perfectpan/lint-config/vite-plus";
import { defineConfig } from "vite-plus";

export default defineConfig({
  // The tests start real agent processes; a loaded CI machine can take seconds to start Node.
  test: { testTimeout: 30_000 },
  // it.effect and it.live are test blocks that the standalone-expect rule does not know by default.
  fmt,
  lint: {
    ...lint,
    rules: {
      ...lint.rules,
      "vitest/no-standalone-expect": ["error", { additionalTestBlockFunctions: ["it.effect", "it.live"] }]
    }
  }
});
