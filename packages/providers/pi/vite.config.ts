import { fmt, lint } from "@perfectpan/lint-config/vite-plus";
import { defineConfig } from "vite-plus";

import { withBoundaryLint } from "../../../infra/architecture/lint.ts";

// Usage fixtures are synthetic JSONL records whose bytes the cursor cases read back.
export default defineConfig({
  fmt: { ...fmt, ignorePatterns: ["test/fixtures/**"] },
  lint: withBoundaryLint(lint, import.meta.url)
});
