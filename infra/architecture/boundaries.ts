/**
 * Architecture boundary manifest: which package may import which, and what each layer inside a context package may
 * import. `check-boundaries.ts` applies it to the real import graph of every `packages/<name>/src` file; a new
 * package or dependency starts here. Packages listed before their folder exists are planned contexts.
 */

/**
 * Layer directories of a context package: `src/domain/<concept>/`, the agent adapters at
 * `src/domain/<concept>/adapters/` (inside `domain/` but judged as their own layer), `src/application/` and
 * `src/infra/`. Other files (`public.ts`, `index.ts`) are unrestricted. Sources under `src/` are plain `.ts` files:
 * declaration and JavaScript files would hide imports from the check.
 */
export type Layer = "domain" | "adapters" | "application" | "infra";

export interface PackageRule {
  /** Workspace packages this package may import, always by bare name, which resolves to the target's `index.ts`. */
  readonly dependsOn: readonly string[];
  /** Packages of `dependsOn` that every file of this package may only use through `import type` / `export type`. */
  readonly typesOnly?: readonly string[];
  /**
   * Workspace packages that only the package's tests, outside `src/`, use: allowed as devDependencies and refused in
   * every `src/` file.
   */
  readonly testsOnly?: readonly string[];
  /**
   * Exact npm import specifiers this package may use outside `domain/`, so that a subpath such as `zod` versus
   * `zod/mini` is a reviewed choice. Effect is governed by `effect` instead.
   */
  readonly external: readonly string[];
  /** Specifiers of `external` that only these package-relative files may import, to keep a library behind one module. */
  readonly externalOnlyIn?: Readonly<Record<string, readonly string[]>>;
  readonly nodeBuiltins?: true;
  /**
   * A published package that keeps its own code instead of re-exporting internal packages: each public entry's code
   * lives under `src/<entry>/`, with the layers at `src/<entry>/<layer>/` and the entry file `src/<entry>/public.ts`.
   * Shells cannot depend on it.
   */
  readonly entries?: readonly string[];
  /**
   * Exact public entries of a published workspace package that this package may import, each mapped to the internal
   * specifier it publishes, so that the layer and Effect rules treat `/catalog` as the shared kernel, `/platform` as
   * the Platform port and `/platform/effect` as its Effect entry. Any other import of that package is refused.
   */
  readonly publicImports?: Readonly<Record<string, string>>;
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
    /**
     * Subpath of a workspace package's Effect entry, such as `@rivus/agent-kit-platform/effect` for its
     * `src/effect.ts`. Siblings import it instead of the package's `index.ts`, which stays free of Effect. Importing
     * it, by name from a sibling or by a relative path inside the package, counts as importing Effect.
     */
    readonly workspaceEntry: string;
    /** Package-relative path prefixes that may import Effect, even with `import type`. */
    readonly allowedPaths: Readonly<Record<string, readonly string[]>>;
  };
}

const PLATFORM = "@rivus/agent-kit-platform";
const PLATFORM_NODE = "@rivus/agent-kit-platform-node";
const CATALOG = "@rivus/agent-kit-catalog";
const SESSIONS = "@rivus/agent-kit-sessions";
const DISCOVERY = "@rivus/agent-kit-discovery";
const HARNESS = "@rivus/agent-kit-harness";
const COST = "@rivus/agent-kit-cost";
const SHELL = "@rivus/agent-kit";
const COLLAB = "@rivus/agent-kit-collab";
const ACP = "@rivus/agent-kit-acp";
const TESTING = "@rivus/agent-kit-testing";

export const boundaries: BoundaryRules = {
  packages: {
    [PLATFORM]: { dependsOn: [], external: [] },
    [PLATFORM_NODE]: { dependsOn: [PLATFORM], external: ["zod/mini"], nodeBuiltins: true },
    [CATALOG]: { dependsOn: [], external: [] },
    // zod/mini is the only zod entry the plan allows. es-toolkit's root export is tree-shakable; its lodash-compatible
    // `es-toolkit/compat` layer is deliberately not allowed.
    [SESSIONS]: { dependsOn: [CATALOG, PLATFORM], external: ["zod/mini", "es-toolkit"] },
    [DISCOVERY]: { dependsOn: [CATALOG, PLATFORM], external: ["zod/mini"] },
    // The built `/harness/events` entry imports nothing, which check-dist enforces; tsdown bundles zod/mini into the
    // entries that use it. The hook path stays synchronous and reads its payload through schemas. The configuration
    // editors keep comments and formatting (plan 3.12); the injection tests run on the Node platform.
    [HARNESS]: {
      dependsOn: [CATALOG, PLATFORM],
      external: ["zod/mini", "es-toolkit", "jsonc-parser", "@decimalturn/toml-patch"],
      testsOnly: [PLATFORM_NODE]
    },
    // cost is pure computation that takes nothing but types from sessions, in its entry files too; check-dist keeps
    // the built `/cost` entry free of imports. Its LiteLLM adapter parses the price list with zod/mini, which tsdown
    // bundles into the entry.
    [COST]: { dependsOn: [CATALOG, SESSIONS], typesOnly: [SESSIONS], external: ["zod/mini"] },
    // The ACP SDK is an internal dependency kept behind one module, so no SDK type reaches public.ts. The tests spawn a
    // fake agent through the Node platform, which only applications may provide.
    [ACP]: {
      dependsOn: [CATALOG, PLATFORM, SESSIONS],
      testsOnly: [PLATFORM_NODE],
      external: ["zod/mini", "@agentclientprotocol/sdk"],
      externalOnlyIn: { "@agentclientprotocol/sdk": ["src/application/services/wire.ts"] }
    },
    // es-toolkit gives the runner-agnostic conformance checks a deep equality without a test framework.
    "@rivus/agent-kit-testing": {
      dependsOn: [PLATFORM, CATALOG, SESSIONS, DISCOVERY, HARNESS, COST],
      external: ["es-toolkit"]
    },
    // A utility module of pure functions; es-toolkit's isPlainObject is its one dependency.
    "@rivus/agent-kit-redact": { dependsOn: [], external: ["es-toolkit"] },
    // The second published package. It reaches agent-kit only through its public entries, which are peers at
    // runtime, so a process holds one copy of the Platform types and the Result helpers.
    [COLLAB]: {
      dependsOn: [SHELL],
      external: ["zod/mini"],
      entries: ["lanes", "lease", "process-lock"],
      publicImports: {
        [`${SHELL}/catalog`]: CATALOG,
        [`${SHELL}/platform`]: PLATFORM,
        [`${SHELL}/platform/effect`]: `${PLATFORM}/effect`
      }
    }
  },
  shells: [SHELL],
  sharedKernel: CATALOG,
  layers: {
    // The domain does no IO, so it never sees the Platform port, not even its types, and never reaches the agent
    // adapters inside it: domain/<concept>/ may not import any adapters/ folder, its own or another concept's.
    domain: { layers: ["domain"], workspace: "kernel-and-types", hidden: [PLATFORM, PLATFORM_NODE], external: false },
    // The agent adapters translate external formats into the domain model, one folder per concept whose model they
    // produce. They may use every domain concept, also across concepts, and need the shared kernel because adapter
    // tables are keyed by CodingAgentId.
    adapters: { layers: ["domain", "adapters"], workspace: "kernel", external: true },
    application: { layers: ["domain", "adapters", "application"], workspace: "any", external: true },
    infra: { layers: ["domain", "application", "infra"], workspace: "any", external: true }
  },
  effect: {
    specifier: /^(?:effect|@effect\/[^/]+)(?:\/|$)/,
    workspaceEntry: "/effect",
    allowedPaths: {
      // The Platform port as an Effect service and its Node Layer; `/platform` and `/node` stay plain.
      [PLATFORM]: ["src/effect.ts"],
      [PLATFORM_NODE]: ["src/effect.ts"],
      // The testing package's aggregate-repository conformance suite, exported as `<package>/public/effect`.
      [TESTING]: ["src/effect.ts"],
      "@rivus/agent-kit-harness": ["src/application/", "src/infra/"],
      [ACP]: ["src/application/", "src/infra/"],
      [COLLAB]: ["src/lease/application/", "src/lease/infra/", "src/lanes/application/", "src/lanes/infra/"]
    }
  }
};
