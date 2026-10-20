import { execFileSync } from "node:child_process";
import process from "node:process";
import { parseArgs } from "node:util";

import {
  findRepositoryRoot,
  fixedGroupVersion,
  pendingChangesets as readPendingChangesets,
  readFixedGroups,
  readWorkspacePackages,
  releaseState,
  remoteTagCommit
} from "./lib/workspace.ts";

const USAGE = `usage: node scripts/release-state.ts [--remote <name>]
Prints state=<version|publish|none> and tag=v<fixed group version> as GitHub Actions output lines.`;

const { values } = parseArgs({
  options: {
    remote: { type: "string", default: "origin" },
    help: { type: "boolean", short: "h" }
  }
});
if (values.help === true) {
  console.log(USAGE);
  process.exit(0);
}

const root = findRepositoryRoot();
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

// Every package of the fixed group shares this version and the one tag; they are released together.
const group = fixedGroupVersion(readFixedGroups(root), readWorkspacePackages(root));
if ("errors" in group) {
  for (const error of group.errors) {
    console.error(`release-state: ${error}`);
  }
  process.exit(1);
}
const tag = `v${group.version}`;
const pendingChangesets = readPendingChangesets(root);
const head = git("rev-parse", "HEAD");
const taggedCommit = remoteTagCommit(git("ls-remote", values.remote, `refs/tags/${tag}`, `refs/tags/${tag}^{}`), tag);
const state = releaseState({ pendingChangesets, version: group.version, head, taggedCommit });

console.error(
  `release-state: ${state} (${pendingChangesets.length} pending changeset(s), fixed group ${group.version} for ` +
    `${group.members.join(", ")}, ${values.remote} ${tag} at ${taggedCommit ?? "(none)"}, HEAD ${head})`
);
console.log(`state=${state}\ntag=${tag}`);
