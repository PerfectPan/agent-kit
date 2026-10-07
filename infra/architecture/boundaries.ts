/**
 * Architecture boundary manifest: which package may import which, and what each layer inside a context package may
 * import. `check-boundaries.ts` applies it to the real import graph of every `packages/<name>/src` file; a new
 * package or dependency starts here. Packages listed before their folder exists are planned contexts.
 */

/**
 * Directories directly under `src/` of a context package. Other files (`public.ts`, `index.ts`) are unrestricted.
 * Sources under `src/` are plain `.ts` files: declaration and JavaScript files would hide imports from the check.
 */
export type Layer = "domain" | "agents" | "protocols" | "application" | "adapters";

export interface PackageRule {
  /** Workspace packages this package may import, always by bare name, which resolves to the target's `index.ts`. */
  readonly dependsOn: readonly string[];
  /**
   * Exact npm import specifiers this package may use outside `domain/`, so that a subpath such as `zod` versus
   * `zod/mini` is a reviewed choice. Effect is governed by `effect` instead.
   */
  readonly external: readonly string[];
  readonly nodeBuiltins?: true;
}

export interface LayerRule {
  /** Layers of the same package this layer may import. */
  readonly layers: readonly Layer[];
  /**
   * Imports of declared upstream packages: `any`; `kernel` allows only the shared kernel; `kernel-and-types` also
   * allows declaration-level `import type` / `export type` from the other declared packages.
   */
  readonly workspace: "any" | "kernel" | "kernel-and-types";
  /** Workspace packages this layer may not import at all, not even their types. */
  readonly hidden?: readonly string[];
  readonly external: boolean;
}

export interface BoundaryRules {
  readonly packages: Readonly<Record<string, PackageRule>>;
  /** Published packages whose `src/<entry>.ts` files only re-export names from internal packages' `public.ts`. */
  readonly shells: readonly string[];
  readonly sharedKernel: string;
  readonly layers: Readonly<Record<Layer, LayerRule>>;
  readonly effect: {
    readonly specifier: RegExp;
    /** Package-relative path prefixes that may import Effect, even with `import type`. */
    readonly allowedPaths: Readonly<Record<string, readonly string[]>>;
  };
}

const PLATFORM = "@rivus/agent-kit-platform";
const PLATFORM_NODE = "@rivus/agent-kit-platform-node";
const CATALOG = "@rivus/agent-kit-catalog";
const SESSIONS = "@rivus/agent-kit-sessions";

export const boundaries: BoundaryRules = {
  packages: {
    [PLATFORM]: { dependsOn: [], external: [] },
    [PLATFORM_NODE]: { dependsOn: [PLATFORM], external: [], nodeBuiltins: true },
    [CATALOG]: { dependsOn: [], external: [] },
    // zod/mini is the only zod entry the plan allows. es-toolkit's root export is tree-shakable; its lodash-compatible
    // `es-toolkit/compat` layer is deliberately not allowed.
    [SESSIONS]: { dependsOn: [CATALOG, PLATFORM], external: ["zod/mini", "es-toolkit"] },
    // es-toolkit gives the runner-agnostic conformance checks a deep equality without a test framework.
    "@rivus/agent-kit-testing": { dependsOn: [PLATFORM, CATALOG, SESSIONS], external: ["es-toolkit"] }
  },
  shells: ["@rivus/agent-kit"],
  sharedKernel: CATALOG,
  layers: {
    // The domain does no IO, so it never sees the Platform port, not even its types.
    domain: { layers: ["domain"], workspace: "kernel-and-types", hidden: [PLATFORM, PLATFORM_NODE], external: false },
    // agents/ and protocols/ translate external formats into the domain model. They need the shared kernel because
    // adapter tables are keyed by CodingAgentId.
    agents: { layers: ["domain", "agents", "protocols"], workspace: "kernel", external: true },
    protocols: { layers: ["domain", "protocols"], workspace: "kernel", external: true },
    application: { layers: ["domain", "agents", "protocols", "application"], workspace: "any", external: true },
    adapters: { layers: ["domain", "application", "adapters"], workspace: "any", external: true }
  },
  effect: {
    specifier: /^(?:effect|@effect\/[^/]+)(?:\/|$)/,
    allowedPaths: {
      "@rivus/agent-kit-harness": ["src/application/", "src/adapters/"],
      "@rivus/agent-kit-acp": ["src/application/", "src/adapters/"],
      "@rivus/agent-kit-collab": [
        "src/lease/application/",
        "src/lease/adapters/",
        "src/lanes/application/",
        "src/lanes/adapters/"
      ]
    }
  }
};
