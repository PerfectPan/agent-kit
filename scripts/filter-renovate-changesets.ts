import { readFileSync, writeFileSync } from "node:fs";

import { filterDependencyUpdates } from "./lib/renovate-changeset.ts";
import { findRepositoryRoot, readWorkspacePackages } from "./lib/workspace.ts";

const packages = readWorkspacePackages(findRepositoryRoot());
for (const file of process.argv.slice(2)) {
  const original = readFileSync(file, "utf8");
  const filtered = filterDependencyUpdates(original, packages);
  if (filtered !== original) {
    writeFileSync(file, filtered);
  }
}
