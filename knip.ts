import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { knip } from '@perfectpan/lint-config/knip';
import type { KnipConfig } from 'knip';

// Packages that publish every subpath from dist/ need their source entry points spelled out:
// pack replaces the exports map with dist paths, so `./subpath` maps back to the source file
// behind it. Subpaths without a source file (./package.json) are skipped.
function sourceEntries(
  directory: string,
  toSource: (subpath: string) => string
): string[] {
  const manifest = JSON.parse(readFileSync(new URL(`./${directory}/package.json`, import.meta.url), 'utf8')) as {
    exports?: Record<string, unknown>;
  };
  return Object.keys(manifest.exports ?? {})
    .map(subpath => (subpath === '.' ? toSource('.') : toSource(subpath.slice(2))))
    .filter(sourcePath => existsSync(new URL(`./${directory}/${sourcePath}`, import.meta.url)))
    .map(sourcePath => `${sourcePath}!`);
}

// The inline *.test.ts files are discovered by vitest. Unused exports/types are staged for a
// dedicated cleanup pass; configuration and tag hints still fail the run.
const config: KnipConfig = {
  ...knip,
  exclude: ['exports', 'types', 'duplicates'],
  // eslint-plugin-boundaries and oxlint-plugin-eslint are declared in infra/architecture and load
  // through withBoundaryLint in every package's vite.config.ts; eslint-import-resolver-typescript
  // is referenced by name inside the boundaries resolver options; @effect/language-service is a
  // tsconfig language-service plugin. None of these resolve from the file that mentions them.
  ignoreDependencies: [
    '@effect/language-service',
    'eslint-import-resolver-typescript',
    'eslint-plugin-boundaries',
    'oxlint-plugin-eslint'
  ],
  workspaces: {
    '.': {},
    'packages/agent-kit': {
      // One source file per subpath export: ./cost/prices builds src/cost/prices.ts.
      entry: sourceEntries('packages/agent-kit', subpath => `src/${subpath}.ts`),
      // The ACP SDK is internal to the /acp bundle and @decimalturn/toml-patch and shell-quote
      // ship inside dist (governed by check-dist.ts and .size-limit.ts); es-toolkit and
      // jsonc-parser resolve from this package's context when packing bundles the workspace
      // harness sources. None of the five is imported from this package's own src.
      ignoreDependencies: [
        '@agentclientprotocol/sdk',
        '@decimalturn/toml-patch',
        'es-toolkit',
        'jsonc-parser',
        'shell-quote'
      ]
    },
    'packages/agent-kit-collab': {
      // One entry per subpath export: ./lease builds src/lease/public.ts; the lease and
      // process-lock workers are spawned by path from the tests.
      entry: [
        ...sourceEntries('packages/agent-kit-collab', subpath => `src/${subpath}/public.ts`),
        'test/workers/*.ts!'
      ]
    },
    'packages/harness': {
      // The legacy OpenCode plugin is loaded by path from the fixtures-driven tests.
      entry: ['test/workers/*.ts!', 'test/fixtures/*.js!']
    },
    'apps/website': {
      // TanStack Start registers the file-based routes on its own; @rivus/agent-kit-collab is
      // resolved from this package by website-api's generate-api-reference.ts, never imported.
      entry: ['src/routes/**/*.{ts,tsx}!'],
      ignoreDependencies: ['@rivus/agent-kit-collab']
    },
    'apps/website-api': {
      // typedoc and typedoc-plugin-markdown are spawned through createRequire by
      // src/generate-api-reference.ts, which Knip cannot follow.
      ignoreDependencies: ['typedoc', 'typedoc-plugin-markdown']
    }
  }
};

export default config;
