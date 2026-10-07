import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

import {
  CHANGES_DIRECTORY,
  type PackageManifest,
  readJson,
  readPolicies,
  readProjects,
  releaseErrors
} from "./lib/workspace.ts";

const USAGE = "usage: node scripts/check-release.ts <tag> [--repository owner/name] [--policy <name>] [--verify-git]";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    repository: { type: "string" },
    policy: { type: "string" },
    "verify-git": { type: "boolean" },
    help: { type: "boolean", short: "h" }
  }
});
if (values.help === true) {
  console.log(USAGE);
  process.exit(0);
}

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

const tag = positionals[0] ?? process.env.RELEASE_TAG;
const repository = values.repository ?? process.env.GITHUB_REPOSITORY ?? "";
const policies = readPolicies(root);
const policy = values.policy
  ? policies.find((candidate) => candidate.policyName === values.policy)
  : policies.length === 1
    ? policies[0]
    : undefined;
if (policy === undefined) {
  console.error(`check-release: --policy must name one of ${policies.map((p) => p.policyName).join(", ")}\n${USAGE}`);
  process.exit(1);
}

const packages = readProjects(root)
  .filter((project) => project.versionPolicyName === policy.policyName)
  .map((project) => ({
    project,
    manifest: readJson<PackageManifest>(root, join(project.projectFolder, "package.json"))
  }));

let pendingChangeFiles: string[] = [];
try {
  pendingChangeFiles = readdirSync(join(root, CHANGES_DIRECTORY), { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".json"))
    .sort();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
    throw error;
  }
}

const errors = releaseErrors({ tag, repository, policy, packages, pendingChangeFiles });

if (values["verify-git"] === true) {
  const head = git("rev-parse", "HEAD");
  try {
    const tagged = git("rev-parse", `refs/tags/${tag}^{commit}`);
    if (tagged !== head) {
      errors.push(`HEAD ${head} is not the commit tagged ${tag} (${tagged})`);
    }
  } catch {
    errors.push(`tag ${tag} does not exist locally`);
  }
  if (git("status", "--porcelain") !== "") {
    errors.push("worktree must be clean");
  }
  try {
    git("merge-base", "--is-ancestor", "HEAD", "origin/main");
  } catch {
    errors.push("release commit must be on origin/main");
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`check-release: ${error}`);
  }
  process.exit(1);
}
const names = packages.map(({ project }) => project.packageName).join(", ");
console.log(`check-release: ok (${policy.policyName} ${tag}: ${names})`);
