import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

import { type ReleaseNotesEntry, renderReleaseNotes } from "./lib/release-notes.ts";
import { readPolicies, readProjects } from "./lib/workspace.ts";

const USAGE = `usage: node scripts/release-notes.ts
Prints the Version Packages pull request body on stdout.`;

const { values } = parseArgs({
  options: {
    help: { type: "boolean", short: "h" }
  }
});
if (values.help === true) {
  console.log(USAGE);
  process.exit(0);
}

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

const policies = readPolicies(root);
const [policy] = policies;
if (policies.length !== 1 || policy?.definitionName !== "lockStepVersion" || policy.version === undefined) {
  console.error("release-notes: the release PR body needs exactly one lockStepVersion policy with a version");
  process.exit(1);
}
const { policyName, version } = policy;

const entries: ReleaseNotesEntry[] = readProjects(root)
  .filter((project) => project.versionPolicyName === policyName)
  .map((project) => ({
    name: project.packageName,
    version,
    changelog: readFileSync(join(root, project.projectFolder, "CHANGELOG.md"), "utf8")
  }));

const body = renderReleaseNotes(entries);
process.stdout.write(`${body}\n`);
console.error(
  `release-notes: ${policyName} ${version} for ${entries.map((entry) => entry.name).join(", ")}, ` +
    `${body.length} characters`
);
