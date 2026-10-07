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
 * A changed file needs a release note when it can change what a published package ships: its source,
 * manifest and build config, or the lockfile that pins its dependencies. Tests, fixtures and Markdown do not.
 * `rush change --verify` only looks inside project folders, so the lockfile rule is what this adds.
 */
export function isShippedChange(path: string, projects: RushProject[]): boolean {
  if (path === LOCKFILE) {
    return true;
  }
  const project = projects.find((candidate) => path.startsWith(`${candidate.projectFolder}/`));
  if (project === undefined || !isPublished(project)) {
    return false;
  }
  return !/\.test\.[cm]?[jt]sx?$/.test(path) && !/(^|\/)(fixtures|__tests__)\//.test(path) && !path.endsWith(".md");
}

export function isChangeFile(path: string): boolean {
  return path.startsWith(`${CHANGES_DIRECTORY}/`) && path.endsWith(".json");
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
