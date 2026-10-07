import { execFileSync } from "node:child_process";
import process from "node:process";
import { parseArgs } from "node:util";

import { readPendingChangeFiles, readPolicies, releaseState, remoteTagCommit } from "./lib/workspace.ts";

const USAGE = `usage: node scripts/release-state.ts [--remote <name>]
Prints state=<version|publish|none> and tag=v<policy version> as GitHub Actions output lines.`;

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

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

const policies = readPolicies(root);
const [policy] = policies;
if (policies.length !== 1 || policy?.definitionName !== "lockStepVersion" || policy.version === undefined) {
  console.error("release-state: automatic releases need exactly one lockStepVersion policy with a version");
  process.exit(1);
}

const tag = `v${policy.version}`;
const pendingChangeFiles = readPendingChangeFiles(root);
const head = git("rev-parse", "HEAD");
const taggedCommit = remoteTagCommit(git("ls-remote", values.remote, `refs/tags/${tag}`, `refs/tags/${tag}^{}`), tag);
const state = releaseState({ pendingChangeFiles, version: policy.version, head, taggedCommit });

console.error(
  `release-state: ${state} (${pendingChangeFiles.length} pending change file(s), policy ${policy.policyName} ` +
    `${policy.version}, ${values.remote} ${tag} at ${taggedCommit ?? "(none)"}, HEAD ${head})`
);
console.log(`state=${state}\ntag=${tag}`);
