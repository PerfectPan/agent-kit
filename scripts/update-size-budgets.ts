import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

import { parseMeasurements, rewriteLimits, SIZE_LIMIT_PACKAGES } from "./lib/size-budgets.ts";
import { findRepositoryRoot } from "./lib/workspace.ts";

const USAGE = `usage: pnpm size:update
Builds the published packages, measures every size-limit entry and sets each budget in their .size-limit.ts to the
measured size plus 2%, at least 256 B.`;

const { values } = parseArgs({ options: { help: { type: "boolean", short: "h" } } });
if (values.help === true) {
  console.log(USAGE);
  process.exit(0);
}

const root = findRepositoryRoot();

function run(args: string[], cwd: string): string {
  const result = spawnSync("pnpm", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  if (result.error !== undefined) {
    throw result.error;
  }
  // size-limit exits 1 when an entry is over its budget, which is the case this script exists for; its JSON output
  // still lists every size, and parseMeasurements rejects output without them.
  if (result.status !== 0 && args[1] !== "size-limit") {
    throw new Error(`pnpm ${args.join(" ")} exited with ${result.status}`);
  }
  return result.stdout;
}

run(["--filter", "@rivus/agent-kit", "--filter", "@rivus/agent-kit-collab", "run", "build"], root);
for (const dir of SIZE_LIMIT_PACKAGES) {
  const config = join(root, dir, ".size-limit.ts");
  const entries = parseMeasurements(run(["exec", "size-limit", "--json"], join(root, dir)));
  const before = readFileSync(config, "utf8");
  const after = rewriteLimits(before, entries);
  writeFileSync(config, after);
  console.log(`${dir}/.size-limit.ts: ${entries.length} entries, ${before === after ? "unchanged" : "updated"}`);
}
