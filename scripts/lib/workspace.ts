import { readFileSync } from "node:fs";
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
}

/** Returns every reason the release cannot be published; an empty list means the release set is valid. */
export function releaseErrors({ tag, repository, policy, packages, pendingChangeFiles }: ReleaseInput): string[] {
  const errors: string[] = [];
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
  }

  if (pendingChangeFiles.length > 0) {
    errors.push(`unreleased change files remain; run Version Packages first: ${pendingChangeFiles.join(", ")}`);
  }
  return errors;
}
