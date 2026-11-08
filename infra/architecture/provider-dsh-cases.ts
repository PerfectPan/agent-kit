import { rejects, type Case } from "./case.ts";

// The `records/**` entries of the usage provider-entry allowlist already cover usage importing `records/zstd.ts`
// generically, so no allowed case is needed; the rejects cases pin that the shared frame reader keeps the slim
// import graph and never reaches the sessions translation.
export const dshCases: Case[] = [
  rejects(
    "dsh records frame reader: no sessions",
    "providers/dsh",
    "src/records/zstd.ts",
    'export { createDshTranslation } from "../sessions/events.js";',
    "provider-entry"
  ),
  rejects(
    "dsh usage: no sessions translation",
    "providers/dsh",
    "src/usage.ts",
    'export { createDshTranslation } from "./sessions/events.js";',
    "provider-entry"
  )
];
