import { fmt, lint } from "@perfectpan/lint-config/vite-plus";
import { defineConfig } from "vite-plus";

import { withBoundaryLint } from "../../infra/architecture/lint.ts";

// The fixtures hold scrubbed real agent logs whose bytes the conformance cases read back; formatting them would
// change the data under test.
export default defineConfig({
  fmt: { ...fmt, ignorePatterns: ["test/fixtures/**"] },
  lint: withBoundaryLint(lint, import.meta.url)
});
