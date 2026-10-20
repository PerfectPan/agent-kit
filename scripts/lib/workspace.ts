import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";

export const CHANGES_DIRECTORY = ".changeset";

export interface PackageManifest {
  name?: string;
  version?: string;
  private?: boolean;
  files?: string[];
  publishConfig?: { access?: string };
  repository?: string | { url?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

/** A workspace member other than the root project, with its manifest. */
export interface WorkspacePackage {
  /** Repository-relative directory with forward slashes, such as `packages/agent-kit`. */
  dir: string;
  manifest: PackageManifest;
}

/**
 * `pnpm run release:check -- <args>` forwards the `--` separator verbatim, and parseArgs would treat it as the
 * end-of-options marker and turn the flags behind it into positionals.
 */
export function splitScriptArgs(argv: readonly string[]): string[] {
  const separator = argv.indexOf("--");
  if (separator === -1) {
    return [...argv];
  }
  return [...argv.slice(0, separator), ...argv.slice(separator + 1)];
}

/** The absolute repository root, resolved so that it matches the paths `pnpm ls` reports. */
export function findRepositoryRoot(): string {
  return realpathSync(execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim());
}

/**
 * Parses `pnpm ls -r --depth -1 --json` output into workspace-relative directories. pnpm decides membership from
 * pnpm-workspace.yaml; the root project it also lists holds only the shortcuts and is left out.
 */
export function parseWorkspaceDirectories(root: string, json: string): string[] {
  const listed = JSON.parse(json) as { path: string }[];
  return listed.map(({ path }) => relative(root, path).split("\\").join("/")).filter((dir) => dir !== "");
}

/** Lists the workspace members through pnpm and reads their manifests. */
export function readWorkspacePackages(root: string): WorkspacePackage[] {
  const listed = execFileSync("pnpm", ["ls", "-r", "--depth", "-1", "--json"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });
  return parseWorkspaceDirectories(root, listed).map((dir) => ({
    dir,
    manifest: JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")) as PackageManifest
  }));
}

/** The `versioning.fixed` groups of pnpm-workspace.yaml, as pnpm reads them; pnpm prints `null` when unset. */
export function readFixedGroups(root: string): string[][] {
  const versioning = execFileSync("pnpm", ["config", "get", "versioning", "--json"], { cwd: root, encoding: "utf8" });
  return (JSON.parse(versioning) as { fixed?: string[][] } | null)?.fixed ?? [];
}

/** A package publishes when it is not private; `pnpm publish -r` skips private packages. */
export function isPublishable(pkg: WorkspacePackage): boolean {
  return pkg.manifest.private !== true;
}

/**
 * Pending changesets are the `.changeset/*.md` intent files `pnpm version -r` consumes; README and pnpm's own
 * state files stay. Leftover files mean the release PR has not been merged since the last change.
 */
export function pendingChangesets(root: string): string[] {
  try {
    return readdirSync(join(root, CHANGES_DIRECTORY), { encoding: "utf8" })
      .filter((name) => name.endsWith(".md") && !name.startsWith("README"))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export function repositoryUrl(manifest: PackageManifest): string | undefined {
  return typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url;
}

export function identifiesRepository(url: string | undefined, repository: string): boolean {
  return [
    `git+https://github.com/${repository}.git`,
    `https://github.com/${repository}.git`,
    `https://github.com/${repository}`,
    `git+ssh://git@github.com/${repository}.git`
  ].includes(url ?? "");
}

export interface ReleaseInput {
  tag: string | undefined;
  repository: string;
  packages: WorkspacePackage[];
  pendingChangesets: string[];
}

/** Dependency fields that npm installs for a consumer; devDependencies are not among them. */
const INSTALLED_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"] as const;

/**
 * A published package that a consumer installs with another published package must name it with the `workspace:`
 * protocol, which publishing replaces with a range of the version being released (`workspace:^` becomes
 * `^<version>`); a fixed range would drift from the shared version. A private workspace package is never on the
 * registry, so a published package bundles it as a devDependency instead of installing it.
 */
function installedDependencyErrors(
  name: string,
  manifest: PackageManifest,
  published: ReadonlySet<string>,
  unpublished: ReadonlySet<string>
): string[] {
  const errors: string[] = [];
  for (const field of INSTALLED_FIELDS) {
    for (const [dependency, spec] of Object.entries(manifest[field] ?? {})) {
      if (published.has(dependency) && !spec.startsWith("workspace:")) {
        errors.push(`${name} ${field} must name ${dependency} with the workspace: protocol, got "${spec}"`);
      }
      if (unpublished.has(dependency)) {
        errors.push(`${name} ${field} names ${dependency}, which is not published; make it a devDependency`);
      }
    }
  }
  return errors;
}

/**
 * Returns every reason the release cannot be published; an empty list means the release set is valid. All
 * published packages release at one shared version through the `versioning.fixed` group, so one release tag
 * covers the set.
 */
export function releaseErrors({ tag, repository, packages, pendingChangesets }: ReleaseInput): string[] {
  const errors: string[] = [];
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) {
    errors.push(`repository must be owner/name, got "${repository}"`);
  }
  const published = packages.filter(isPublishable);
  if (published.length === 0) {
    errors.push("the workspace has no published packages");
  }

  if (tag === undefined || tag.length === 0) {
    errors.push("release tag is required");
  }

  // A mismatch between one consistent version and the tag means the tag is wrong; versions that disagree with
  // each other mean a published package is missing from the fixed group.
  const versionsAgree = new Set(published.map(({ manifest }) => manifest.version)).size <= 1;
  const nameOf = ({ dir, manifest }: WorkspacePackage) => manifest.name ?? dir;
  const publishedNames = new Set(published.map(nameOf));
  const unpublishedNames = new Set(packages.filter((pkg) => !isPublishable(pkg)).map(nameOf));

  for (const pkg of published) {
    const { manifest } = pkg;
    const name = nameOf(pkg);
    if (manifest.version === undefined || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
      errors.push(`${name} version must be a stable x.y.z release, got "${manifest.version ?? "(missing)"}"`);
    } else if (tag !== undefined && tag.length > 0 && tag !== `v${manifest.version}`) {
      errors.push(
        versionsAgree
          ? `release tag ${tag} does not match ${name}@${manifest.version}; check the release tag against the ` +
              "shared version of the published packages"
          : `release tag ${tag} does not match ${name}@${manifest.version} (all published packages release at one ` +
              "shared version; add every published package to the versioning.fixed group in pnpm-workspace.yaml)"
      );
    }
    if (manifest.publishConfig?.access !== "public") {
      errors.push(`${name} publishConfig.access must be "public"`);
    }
    if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
      errors.push(`${name} must list published files in "files"`);
    }
    // npm provenance rejects a package whose repository does not match the workflow's repository.
    if (!identifiesRepository(repositoryUrl(manifest), repository)) {
      errors.push(`${name} repository.url must identify github.com/${repository}`);
    }
    errors.push(...installedDependencyErrors(name, manifest, publishedNames, unpublishedNames));
  }

  if (pendingChangesets.length > 0) {
    errors.push(`unreleased changesets remain; merge the release PR first: ${pendingChangesets.join(", ")}`);
  }
  return errors;
}

export type FixedGroupVersion = { members: readonly string[]; version: string } | { errors: string[] };

/**
 * The version that the one `versioning.fixed` group releases at, which names the release tag, or the reasons there
 * is none: automatic releases need exactly one group whose members are workspace packages at one shared version.
 */
export function fixedGroupVersion(
  groups: readonly (readonly string[])[],
  packages: readonly WorkspacePackage[]
): FixedGroupVersion {
  const [members] = groups;
  if (groups.length !== 1 || members === undefined || members.length === 0) {
    return {
      errors: [
        `automatic releases need exactly one versioning.fixed group in pnpm-workspace.yaml, got ${groups.length}`
      ]
    };
  }
  const versions = members.map((name) => ({
    name,
    version: packages.find((pkg) => pkg.manifest.name === name)?.manifest.version
  }));
  const errors = versions
    .filter(({ version }) => version === undefined)
    .map(({ name }) => `${name} in the versioning.fixed group is not a workspace package with a version`);
  const shared = new Set(versions.map(({ version }) => version));
  if (errors.length === 0 && shared.size > 1) {
    const listed = versions.map(({ name, version }) => `${name}@${version}`).join(", ");
    errors.push(`the versioning.fixed group must share one version, got ${listed}`);
  }
  const [version] = shared;
  return errors.length > 0 || version === undefined ? { errors } : { members, version };
}

/** What a push to `main` does: prepare the release PR, publish the fixed group's version, or nothing. */
export type ReleaseState = "version" | "publish" | "none";

export interface ReleaseStateInput {
  pendingChangesets: readonly string[];
  /** The shared version of the `versioning.fixed` group. */
  version: string;
  head: string;
  /** The commit that tag `v<version>` points at on the remote, or undefined when the remote has no such tag. */
  taggedCommit: string | undefined;
}

/**
 * Pending changesets mean the release PR needs preparing. Once a merged release PR has consumed them, the version
 * is published unless its tag already exists on another commit. A tag on this commit means an earlier run for it
 * stopped after pushing the tag, so publishing again resumes that release; `pnpm publish -r` skips versions already
 * on npm. An initial `0.0.0` is never released.
 */
export function releaseState({ pendingChangesets, version, head, taggedCommit }: ReleaseStateInput): ReleaseState {
  if (pendingChangesets.length > 0) {
    return "version";
  }
  if (version === "0.0.0" || (taggedCommit !== undefined && taggedCommit !== head)) {
    return "none";
  }
  return "publish";
}

/** Reads the commit `tag` points at from `git ls-remote <remote> refs/tags/<tag> 'refs/tags/<tag>^{}'` output. */
export function remoteTagCommit(lsRemote: string, tag: string): string | undefined {
  const commits = new Map(
    lsRemote
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha, ref] = line.split("\t");
        return [ref, sha];
      })
  );
  // An annotated tag lists the tag object under its name and the commit under the peeled `^{}` name.
  return commits.get(`refs/tags/${tag}^{}`) ?? commits.get(`refs/tags/${tag}`);
}
