import { fmt, lint } from "@perfectpan/lint-config/vite-plus";
import { defineConfig } from "vite-plus";

import { withBoundaryLint } from "../../../infra/architecture/lint.ts";

export default defineConfig({
  // Usage fixtures are synthetic message rows whose exact bytes the tests insert into SQLite.
  fmt: { ...fmt, ignorePatterns: ["test/fixtures/**"] },
  lint: withBoundaryLint(lint, import.meta.url)
});
