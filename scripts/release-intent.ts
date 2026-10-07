import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

import { CHANGES_DIRECTORY, isChangeFile, isPublished, isShippedChange, readProjects } from "./lib/workspace.ts";

const TYPES = ["major", "minor", "patch", "none"];
const USAGE = `usage:
  node scripts/release-intent.ts check [--base <ref>]
  node scripts/release-intent.ts add --type <${TYPES.join("|")}> --message "<text>" [--package <name>]`;

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const projects = readProjects(root);

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function fail(message: string): never {
  console.error(`release-intent: ${message}`);
  process.exit(1);
}

function check(base: string | undefined): void {
  const from = base ?? git("merge-base", "origin/main", "HEAD");
  const changed = git("diff", "--name-only", `${from}...HEAD`).split("\n").filter(Boolean);
  const shipped = changed.filter((path) => isShippedChange(path, projects));
  const changeFiles = changed.filter(isChangeFile);
  if (shipped.length === 0) {
    console.log("release-intent: ok (no shipped files changed)");
    return;
  }
  if (changeFiles.length > 0) {
    console.log(`release-intent: ok (${changeFiles.length} change file(s) for ${shipped.length} shipped file(s))`);
    return;
  }
  console.error(`release-intent: ${shipped.length} shipped file(s) changed without a change file:`);
  for (const path of shipped.slice(0, 20)) {
    console.error(`  - ${path}`);
  }
  if (shipped.length > 20) {
    console.error(`  ... and ${shipped.length - 20} more`);
  }
  console.error("Add one with: node common/scripts/install-run-rush.js change");
  console.error(`If Rush reports nothing to do (for example a lockfile-only change), run:\n${USAGE.split("\n")[2]}`);
  process.exit(1);
}

function add(type: string | undefined, message: string | undefined, packageName: string | undefined): void {
  if (type === undefined || !TYPES.includes(type)) {
    fail(`--type must be one of ${TYPES.join(", ")}`);
  }
  if (type !== "none" && !message?.trim()) {
    fail("--message is required unless --type none");
  }
  const published = projects.filter(isPublished).map((project) => project.packageName);
  const target = packageName ?? (published.length === 1 ? published[0] : undefined);
  if (target === undefined || !published.includes(target)) {
    fail(`--package must be one of ${published.join(", ")}`);
  }
  const branch = git("rev-parse", "--abbrev-ref", "HEAD").replace(/[^\w.-]+/g, "-");
  const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");
  const directory = join(root, CHANGES_DIRECTORY, target);
  const file = join(directory, `${branch}_${stamp}.json`);
  const body = {
    changes: [{ packageName: target, comment: message?.trim() ?? "", type }],
    packageName: target,
    email: git("config", "user.email")
  };
  mkdirSync(directory, { recursive: true });
  writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, { flag: "wx" });
  console.log(`release-intent: wrote ${file.slice(root.length + 1)}`);
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    base: { type: "string" },
    type: { type: "string" },
    message: { type: "string" },
    package: { type: "string" },
    help: { type: "boolean", short: "h" }
  }
});

if (values.help === true) {
  console.log(USAGE);
} else if (positionals[0] === "check") {
  check(values.base);
} else if (positionals[0] === "add") {
  add(values.type, values.message, values.package);
} else {
  fail(USAGE);
}
