import type { SizeLimitConfig } from "size-limit";

// size-limit leaves peers out of the measurement: @rivus/agent-kit and effect are not counted, so an inlined copy of
// either would exceed these budgets. zod/mini, a dependency, is counted.
export default [
  { name: "@rivus/agent-kit-collab/lanes", path: "dist/lanes.js", import: "*", limit: "2 kB" },
  // The file lease envelope parses with zod/mini, which the measurement counts in. /process-lock shares this
  // entry's chunk and bundles its own zod/mini there, so the budget also counts that copy.
  { name: "@rivus/agent-kit-collab/lease", path: "dist/lease.js", import: "*", limit: "11 kB" },
  // The holder file's ENOENT read and the SQLite busy check parse with zod/mini, which the measurement counts in.
  { name: "@rivus/agent-kit-collab/process-lock", path: "dist/process-lock.js", import: "*", limit: "6.25 kB" }
] satisfies SizeLimitConfig;
