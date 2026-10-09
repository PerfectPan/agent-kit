import { fmt, lint } from "@perfectpan/lint-config/vite-plus";
import { defineConfig } from "vite-plus";

// The fixtures hold scrubbed real agent logs whose bytes the conformance cases read back; formatting them would
// change the data under test.
export default defineConfig({ fmt: { ...fmt, ignorePatterns: ["test/fixtures/**"] }, lint });
