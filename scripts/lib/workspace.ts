import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Rush accepts comments in its JSON files; these scripts use JSON.parse, so keep rush.json and
// version-policies.json free of comments.
export const LOCKFILE = "common/config/rush/pnpm-lock.yaml";
export const CHANGES_DIRECTORY = "common/changes";

export interface RushProject {
  packageName: string;
  projectFolder: string;
  versionPolicyName?: string;
  shouldPublish?: boolean;
}

export interface VersionPolicy {
  policyName: string;
  definitionName: "lockStepVersion" | "individualVersion";
  version?: string;
}

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

export function readJson<T>(root: string, path: string): T {
  return JSON.parse(readFileSync(join(root, path), "utf8")) as T;
}

export function readProjects(root: string): RushProject[] {
  return readJson<{ projects: RushProject[] }>(root, "rush.json").projects;
}

export function readPolicies(root: string): VersionPolicy[] {
  return readJson<VersionPolicy[]>(root, "common/config/rush/version-policies.json");
}

/** Change files that `rush version --bump` has not consumed yet, relative to `common/changes`. */
export function readPendingChangeFiles(root: string): string[] {
  try {
    return readdirSync(join(root, CHANGES_DIRECTORY), { recursive: true, encoding: "utf8" })
      .filter((path) => path.endsWith(".json"))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/** Rush publishes a project that has a version policy or sets `shouldPublish`. */
export function isPublished(project: RushProject): boolean {
  return project.shouldPublish === true || project.versionPolicyName !== undefined;
}

/**
 * Maps each private workspace package to the published packages that list it with the `workspace:` protocol and
 * therefore bundle it. `manifests` is keyed by package name.
 */
export function bundlersOf(
  projects: RushProject[],
  manifests: ReadonlyMap<string, PackageManifest>
): Map<string, string[]> {
  const bundlers = new Map<string, string[]>();
  for (const project of projects.filter(isPublished)) {
    const manifest = manifests.get(project.packageName);
    const dependencies = { ...manifest?.dependencies, ...manifest?.devDependencies };
    for (const [name, spec] of Object.entries(dependencies)) {
      const dependency = projects.find((candidate) => candidate.packageName === name);
      if (spec.startsWith("workspace:") && dependency !== undefined && !isPublished(dependency)) {
        bundlers.set(name, [...(bundlers.get(name) ?? []), project.packageName]);
      }
    }
  }
  return bundlers;
}

/**
 * Published packages whose next release a changed file belongs to: the package that contains it or, for a private
 * package, the published packages that bundle it. Tests, fixtures and Markdown ship nothing. The lockfile is not
 * attributed to a package; `releaseIntent` handles it.
 */
export function releasesOf(path: string, projects: RushProject[], bundlers: ReadonlyMap<string, string[]>): string[] {
  const project = projects.find((candidate) => path.startsWith(`${candidate.projectFolder}/`));
  const shipsNothing =
    /\.test\.[cm]?[jt]sx?$/.test(path) || /(^|\/)(fixtures|__tests__)\//.test(path) || path.endsWith(".md");
  if (project === undefined || shipsNothing) {
    return [];
  }
  return isPublished(project) ? [project.packageName] : (bundlers.get(project.packageName) ?? []);
}

export function isChangeFile(path: string): boolean {
  return path.startsWith(`${CHANGES_DIRECTORY}/`) && path.endsWith(".json");
}

/** `common/changes/@scope/name/x.json` belongs to `@scope/name`. */
export function changeFilePackage(path: string): string {
  return path.slice(CHANGES_DIRECTORY.length + 1, path.lastIndexOf("/"));
}

/** One entry of `git diff --name-status --no-renames`; `status` is the letter, such as `A`, `M` or `D`. */
export interface FileChange {
  status: string;
  path: string;
}

/** Parses `git diff --name-status --no-renames -z` output, which alternates status and path, NUL-separated. */
export function parseNameStatus(output: string): FileChange[] {
  const fields = output.split("\0").filter(Boolean);
  const changes: FileChange[] = [];
  for (let at = 0; at + 1 < fields.length; at += 2) {
    changes.push({ status: fields[at]!.charAt(0), path: fields[at + 1]! });
  }
  return changes;
}

export interface ReleaseIntent {
  /** Changed files that can change what a published package ships, including the lockfile. */
  shipped: string[];
  /** Change files that count as release records: added or modified by the change, so they exist at its head. */
  changeFiles: string[];
  /** Published packages with shipped changes but no change file. */
  missing: string[];
  /** The lockfile changed and no package has a change file. */
  unrecordedLockfile: boolean;
}

/**
 * Checks that every published package with shipped changes has a change file. Rush asks only for published projects
 * that changed, so a change inside a private package bundled into a published one, or to the lockfile, would
 * otherwise go out without a release. A deleted change file records nothing.
 */
export function releaseIntent(
  changes: readonly FileChange[],
  projects: RushProject[],
  bundlers: ReadonlyMap<string, string[]>
): ReleaseIntent {
  const changeFiles = changes
    .filter(({ status, path }) => (status === "A" || status === "M") && isChangeFile(path))
    .map(({ path }) => path);
  const recorded = new Set(changeFiles.map(changeFilePackage));
  const releases = new Set<string>();
  const shipped: string[] = [];
  for (const { path } of changes) {
    const affected = path === LOCKFILE ? [] : releasesOf(path, projects, bundlers);
    if (path === LOCKFILE || affected.length > 0) {
      shipped.push(path);
    }
    for (const name of affected) {
      releases.add(name);
    }
  }
  return {
    shipped,
    changeFiles,
    missing: [...releases].filter((name) => !recorded.has(name)).sort(),
    unrecordedLockfile: shipped.includes(LOCKFILE) && recorded.size === 0
  };
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
  policy: VersionPolicy;
  packages: { project: RushProject; manifest: PackageManifest }[];
  pendingChangeFiles: string[];
  /** Names of the workspace projects that are not published, such as the internal packages a shell bundles. */
  unpublished: readonly string[];
}

/** Dependency fields that npm installs for a consumer; devDependencies are not among them. */
const INSTALLED_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"] as const;

/** Returns every reason the release cannot be published; an empty list means the release set is valid. */
export function releaseErrors({
  tag,
  repository,
  policy,
  packages,
  pendingChangeFiles,
  unpublished
}: ReleaseInput): string[] {
  const errors: string[] = [];
  const members = new Set(packages.map(({ project }) => project.packageName));
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) {
    errors.push(`repository must be owner/name, got "${repository}"`);
  }
  if (packages.length === 0) {
    errors.push(`version policy ${policy.policyName} has no projects`);
  }

  if (policy.definitionName === "lockStepVersion") {
    const version = policy.version ?? "";
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      errors.push(`policy ${policy.policyName} version must be a stable x.y.z release, got "${version}"`);
    }
    if (tag !== `v${version}`) {
      errors.push(`release tag ${tag ?? "(missing)"} does not match policy version v${version}`);
    }
  } else if (tag === undefined || tag.length === 0) {
    errors.push("release tag is required");
  }

  for (const { project, manifest } of packages) {
    const name = project.packageName;
    if (manifest.name !== name) {
      errors.push(`${project.projectFolder}/package.json name must be ${name}`);
    }
    if (manifest.private === true) {
      errors.push(`${name} is private but belongs to a version policy`);
    }
    if (policy.definitionName === "lockStepVersion" && manifest.version !== policy.version) {
      errors.push(`${name} version ${manifest.version ?? "(missing)"} does not match policy version ${policy.version}`);
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
    errors.push(...installedDependencyErrors(name, manifest, members, unpublished));
  }

  if (pendingChangeFiles.length > 0) {
    errors.push(`unreleased change files remain; merge the release PR first: ${pendingChangeFiles.join(", ")}`);
  }
  return errors;
}

/**
 * A package of the release set that a consumer installs with another member must name it with the `workspace:`
 * protocol, which publishing replaces with a range of the version being released (`workspace:^` becomes
 * `^<version>`); a fixed range would drift from the lockstep version. A private workspace package is never on the
 * registry, so a published package bundles it as a devDependency instead of installing it.
 */
function installedDependencyErrors(
  name: string,
  manifest: PackageManifest,
  members: ReadonlySet<string>,
  unpublished: readonly string[]
): string[] {
  const errors: string[] = [];
  for (const field of INSTALLED_FIELDS) {
    for (const [dependency, spec] of Object.entries(manifest[field] ?? {})) {
      if (members.has(dependency) && !spec.startsWith("workspace:")) {
        errors.push(`${name} ${field} must name ${dependency} with the workspace: protocol, got "${spec}"`);
      }
      if (unpublished.includes(dependency)) {
        errors.push(`${name} ${field} names ${dependency}, which is not published; make it a devDependency`);
      }
    }
  }
  return errors;
}

/** What a push to `main` does: prepare the release PR, publish the policy version, or nothing. */
export type ReleaseState = "version" | "publish" | "none";

export interface ReleaseStateInput {
  pendingChangeFiles: readonly string[];
  /** The lockstep policy version. */
  version: string;
  head: string;
  /** The commit that tag `v<version>` points at on the remote, or undefined when the remote has no such tag. */
  taggedCommit: string | undefined;
}

/**
 * Pending change files mean the release PR needs preparing. Once a merged release PR has consumed them, the version
 * is published unless its tag already exists on another commit. A tag on this commit means an earlier run for it
 * stopped after pushing the tag, so publishing again resumes that release; Rush skips versions already on npm. The
 * policy's initial `0.0.0` is never released.
 */
export function releaseState({ pendingChangeFiles, version, head, taggedCommit }: ReleaseStateInput): ReleaseState {
  if (pendingChangeFiles.length > 0) {
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
