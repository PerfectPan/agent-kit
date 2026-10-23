/**
 * Architecture boundary manifest: which package may import which, and what each layer inside a context package may
 * import. `lint.ts` turns it into the `vp lint` rules of every `packages/<name>/src` file and `manifest.test.ts`
 * checks the package manifests against it; a new package or dependency starts here. Packages listed before their
 * folder exists are planned contexts.
 */

/**
 * Layer directories of a context package: `src/domain/<concept>/`, shared external-format adapters at
 * `src/domain/<concept>/adapters/` (inside `domain/` but judged as their own layer), `src/application/` and
 * `src/infra/`, and pure utilities in `src/lib/`. Entry files (`public.ts`, `spi.ts`) may reach the package's layers. Sources under `src/` are plain `.ts` files:
 * declaration and JavaScript files would hide imports from the check.
 */
export type Layer = "domain" | "adapters" | "application" | "infra" | "lib";

export interface PackageRule {
  /** Entries this package exposes to siblings with dependsOn access; SPI access is declared separately. */
  readonly siblingEntries: readonly string[];
  /** Workspace packages this package may import through their declared sibling entries. */
  readonly dependsOn: readonly string[];
  /** This context exports `src/spi.ts` as `./spi` for provider implementations. */
  readonly spi?: true;
  /** Private provider: one src/<service>.ts export per supported service, with no barrel. */
  readonly providerServices?: readonly string[];
  /** Repository-relative facts path; the marker extractor reads source text without loading the module. */
  readonly providerFacts?: string;
  /** Packages whose `./spi` entries this package may import; this grants no public entry access, and dependsOn grants no SPI access. */
  readonly spiImports?: readonly string[];
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
  /** True allows the package allowlist; a list further restricts it for this layer. */
  readonly external: boolean | readonly string[];
}

export interface BoundaryRules {
  readonly packages: Readonly<Record<string, PackageRule>>;
  /** Published shells that bind providers and re-export named public APIs. */
  readonly shells: readonly string[];
  /** Explicit local imports for shell bindings and per-service assembly; all other local imports are refused. */
  readonly shellImports: Readonly<Record<string, readonly string[]>>;
  readonly sharedKernel: string;
  readonly layers: Readonly<Record<Layer, LayerRule>>;
  readonly effect: {
    /** Base npm package-name patterns; subpaths of these packages count as Effect imports too. */
    readonly modules: readonly string[];
    /**
     * Subpath of a workspace package's Effect entry, such as `@rivus/agent-kit-platform/effect` for its
     * `src/effect.ts`. Siblings import it instead of the package's plain `public.ts` entry. Importing
     * it, by name from a sibling or by a relative path inside the package, counts as importing Effect.
     */
    readonly workspaceEntry: string;
    /** Package-relative path prefixes that may import Effect, even with `import type`. */
    readonly allowedPaths: Readonly<Record<string, readonly string[]>>;
  };
  /**
   * Agent knowledge belongs in providers, so context source may not spell a marker: a string
   * literal or string literal type whose whole value is one, or a piece of a template literal's static text (each part
   * between expressions, split on `/`) that is one.
   */
  readonly agentMarkers: { readonly packages: readonly string[] };
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
const CODEX = "@rivus/agent-kit-provider-codex";
const CLAUDE_CODE = "@rivus/agent-kit-provider-claude-code";
const GROK = "@rivus/agent-kit-provider-grok";
const OPENCODE = "@rivus/agent-kit-provider-opencode";
const GEMINI_CLI = "@rivus/agent-kit-provider-gemini-cli";
const CURSOR = "@rivus/agent-kit-provider-cursor";
const PI = "@rivus/agent-kit-provider-pi";
const TESTING = "@rivus/agent-kit-testing";

export const boundaries: BoundaryRules = {
  packages: {
    [CODEX]: {
      siblingEntries: [],
      providerFacts: "packages/providers/codex/src/facts.ts",
      providerServices: ["identity", "discovery", "hooks", "install", "sessions", "usage", "acp"],
      dependsOn: [],
      spiImports: [CATALOG, DISCOVERY, HARNESS, SESSIONS, ACP],
      testsOnly: [TESTING],
      external: ["zod/mini"]
    },
    [CLAUDE_CODE]: {
      siblingEntries: [],
      providerFacts: "packages/providers/claude-code/src/facts.ts",
      providerServices: ["identity", "discovery", "hooks", "install", "sessions", "usage", "acp"],
      dependsOn: [],
      spiImports: [CATALOG, DISCOVERY, HARNESS, SESSIONS, ACP],
      testsOnly: [TESTING],
      external: ["zod/mini"]
    },
    [GROK]: {
      siblingEntries: [],
      providerFacts: "packages/providers/grok/src/facts.ts",
      providerServices: ["identity", "discovery", "hooks", "install", "sessions", "usage", "acp"],
      dependsOn: [],
      spiImports: [CATALOG, DISCOVERY, HARNESS, SESSIONS, ACP],
      testsOnly: [TESTING, PLATFORM],
      external: ["zod/mini"]
    },
    [OPENCODE]: {
      siblingEntries: [],
      providerFacts: "packages/providers/opencode/src/facts.ts",
      providerServices: ["identity", "discovery", "hooks", "install", "usage", "acp"],
      dependsOn: [],
      spiImports: [CATALOG, DISCOVERY, HARNESS, SESSIONS, ACP],
      testsOnly: [TESTING, PLATFORM_NODE],
      external: ["zod/mini"]
    },
    [GEMINI_CLI]: {
      siblingEntries: [],
      providerFacts: "packages/providers/gemini-cli/src/facts.ts",
      providerServices: ["identity", "discovery", "hooks", "install", "usage", "acp"],
      dependsOn: [],
      spiImports: [CATALOG, DISCOVERY, HARNESS, SESSIONS, ACP],
      testsOnly: [TESTING],
      external: ["zod/mini"]
    },
    [CURSOR]: {
      siblingEntries: [],
      providerFacts: "packages/providers/cursor/src/facts.ts",
      providerServices: ["identity", "discovery", "hooks", "install"],
      dependsOn: [],
      spiImports: [CATALOG, DISCOVERY, HARNESS],
      testsOnly: [TESTING],
      external: ["zod/mini"]
    },
    [PI]: {
      siblingEntries: [],
      providerFacts: "packages/providers/pi/src/facts.ts",
      providerServices: ["identity", "discovery", "hooks", "install", "usage"],
      dependsOn: [],
      spiImports: [CATALOG, DISCOVERY, HARNESS, SESSIONS],
      testsOnly: [TESTING],
      external: ["zod/mini"]
    },
    [PLATFORM]: { siblingEntries: ["public", "effect"], dependsOn: [], external: [] },
    [PLATFORM_NODE]: { siblingEntries: ["public"], dependsOn: [PLATFORM], external: ["zod/mini"], nodeBuiltins: true },
    [CATALOG]: { siblingEntries: ["public"], dependsOn: [], external: [], spi: true },
    // zod/mini is the only zod entry the plan allows. es-toolkit's root export is tree-shakable; its lodash-compatible
    // `es-toolkit/compat` layer is deliberately not allowed.
    [SESSIONS]: {
      siblingEntries: ["public"],
      dependsOn: [CATALOG, PLATFORM],
      external: ["zod/mini", "es-toolkit"],
      spi: true
    },
    [DISCOVERY]: {
      siblingEntries: ["public"],
      dependsOn: [CATALOG, PLATFORM],
      external: ["zod/mini"],
      spi: true,
      testsOnly: [GEMINI_CLI, CODEX]
    },
    // The built `/harness/events` entry imports nothing, which check-dist enforces; `vp pack` bundles zod/mini into the
    // entries that use it. The hook path stays synchronous and reads its payload through schemas. The configuration
    // editors keep comments and formatting (plan 3.12); the injection tests run on the Node platform. shell-quote
    // reads the first word of a hook command for doctor and stays behind that one module.
    [HARNESS]: {
      siblingEntries: ["public/events"],
      spi: true,
      dependsOn: [CATALOG, PLATFORM],
      external: ["zod/mini", "es-toolkit", "jsonc-parser", "@decimalturn/toml-patch", "shell-quote"],
      externalOnlyIn: { "shell-quote": ["src/application/services/hook-program.ts"] },
      testsOnly: [PLATFORM_NODE, PI, CURSOR, GEMINI_CLI, OPENCODE, GROK, CLAUDE_CODE, CODEX]
    },
    // cost is pure computation that takes nothing but types from sessions, in its entry files too; check-dist keeps
    // the built `/cost` entry free of imports. Its LiteLLM adapter parses the price list with zod/mini, which `vp pack`
    // bundles into the entry.
    [COST]: {
      siblingEntries: ["public"],
      dependsOn: [CATALOG, SESSIONS],
      typesOnly: [SESSIONS],
      external: ["zod/mini"]
    },
    // The ACP SDK is an internal dependency kept behind one module, so no SDK type reaches public.ts. The tests spawn a
    // fake agent through the Node platform, which only applications may provide.
    [ACP]: {
      siblingEntries: [],
      spi: true,
      dependsOn: [CATALOG, PLATFORM, SESSIONS],
      testsOnly: [PLATFORM_NODE],
      external: ["zod/mini", "@agentclientprotocol/sdk"],
      externalOnlyIn: { "@agentclientprotocol/sdk": ["src/application/services/wire.ts"] }
    },
    // es-toolkit gives the runner-agnostic conformance checks a deep equality without a test framework.
    "@rivus/agent-kit-testing": {
      siblingEntries: ["public"],
      dependsOn: [PLATFORM, CATALOG, SESSIONS, DISCOVERY, HARNESS, COST],
      spiImports: [HARNESS],
      testsOnly: [PI, CURSOR, GEMINI_CLI, OPENCODE, GROK, CLAUDE_CODE, CODEX, ACP, PLATFORM_NODE],
      external: ["es-toolkit"]
    },
    // A utility module of pure functions; es-toolkit's isPlainObject is its one dependency.
    "@rivus/agent-kit-redact": { siblingEntries: [], dependsOn: [], external: ["es-toolkit"] },
    // The second published package. It reaches agent-kit only through its public entries, which are peers at
    // runtime, so a process holds one copy of the Platform types and the Result helpers.
    [COLLAB]: {
      siblingEntries: [],
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
  shellImports: {
    "src/catalog.ts": ["./providers/identity.js"],
    "src/acp.ts": ["./providers/acp.js", "./providers/types.js"],
    "src/discovery.ts": ["./providers/discovery.js", "./providers/identity.js", "./providers/types.js"],
    "src/harness/events.ts": ["../providers/hooks.js", "../providers/types.js"],
    "src/harness.ts": [
      "./providers/install.js",
      "./providers/hooks.js",
      "./providers/identity.js",
      "./providers/types.js"
    ],
    "src/providers/acp.ts": ["./merge.js", "./types.js"],
    "src/providers/builtin.ts": [
      "./types.js",
      "./identity.js",
      "./discovery.js",
      "./hooks.js",
      "./install.js",
      "./sessions.js",
      "./usage.js",
      "./acp.js"
    ],
    "src/providers/discovery.ts": ["./merge.js", "./types.js"],
    "src/providers/hooks.ts": ["./merge.js", "./types.js"],
    "src/providers/identity.ts": ["./merge.js", "./types.js"],
    "src/providers/install.ts": ["./merge.js", "./types.js"],
    "src/providers/merge.ts": ["./types.js"],
    "src/providers/sessions.ts": ["./merge.js", "./types.js"],
    "src/providers/unsupported.ts": ["./types.js", "./identity.js"],
    "src/providers/usage.ts": ["./merge.js", "./types.js"],
    "src/providers.ts": ["./providers/types.js", "./providers/builtin.js"],
    "src/sessions.ts": ["./providers/sessions.js", "./providers/identity.js", "./providers/types.js"],
    "src/testing.ts": ["./providers/hooks.js", "./providers/identity.js", "./providers/types.js"],
    "src/transcript/usage.ts": ["../providers/usage.js", "../providers/identity.js", "../providers/types.js"],
    "src/transcript.ts": [
      "./providers/sessions.js",
      "./providers/usage.js",
      "./providers/identity.js",
      "./providers/types.js"
    ]
  },
  sharedKernel: CATALOG,
  layers: {
    // The domain does no IO, so it never sees the Platform port, not even its types, and never reaches the shared format
    // adapters inside it: domain/<concept>/ may not import any adapters/ folder, its own or another concept's.
    domain: {
      layers: ["domain", "lib"],
      workspace: "kernel-and-types",
      hidden: [PLATFORM, PLATFORM_NODE],
      external: false
    },
    // Five shared format folders serve harness lifecycle, sessions transcript and usage, cost pricing, and discovery
    // installation. They may use domain concepts and the shared kernel; contexts contain no built-in service tables.
    // Agent-specific adapters live in providers (see docs/architecture/authoring.md).
    adapters: { layers: ["domain", "adapters", "lib"], workspace: "kernel", external: true },
    application: { layers: ["domain", "adapters", "application", "lib"], workspace: "any", external: true },
    infra: { layers: ["domain", "application", "infra", "lib"], workspace: "any", external: true },
    // Pure utilities have no domain or IO dependencies, even when their callers do.
    lib: { layers: ["lib"], workspace: "kernel", external: ["zod/mini"] }
  },
  effect: {
    modules: ["effect", "@effect/*"],
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
  },
  agentMarkers: {
    packages: [CATALOG, DISCOVERY, SESSIONS, HARNESS, ACP, COST]
  }
};
