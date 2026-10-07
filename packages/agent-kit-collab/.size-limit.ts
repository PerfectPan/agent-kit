import type { SizeLimitConfig } from "size-limit";

// size-limit leaves peers out of the measurement: @rivus/agent-kit and effect are not counted, so an inlined copy of
// either would exceed these budgets. zod/mini, a dependency, is counted.
export default [
  { name: "@rivus/agent-kit-collab/lease", path: "dist/lease.js", import: "*", limit: "10 kB" },
  { name: "@rivus/agent-kit-collab/process-lock", path: "dist/process-lock.js", import: "*", limit: "6 kB" }
] satisfies SizeLimitConfig;
