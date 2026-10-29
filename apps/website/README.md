# Website

Private TanStack Start and Fumadocs site. Source is organized by responsibility:

| Folder            | Responsibility                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/routes/`     | Route definitions rendering feature pages; loaders and head functions may call features.                                                                |
| `src/features/`   | Business rules, data, copy, reducers, and component composition, grouped into `landing`, `demo`, `layer`, `docs`, and `i18n`. Small features stay flat. |
| `src/components/` | Pure UI: props in, markup out, callbacks for events. Copy, selections, clipboard flags, and animation state come from features.                         |
| `src/hooks/`      | Business-independent state and effects: language context and persistence, motion, visibility, clipboard, timers, focus, and DOM measurement. No JSX.    |
| `src/lib/`        | Business-independent pure helpers and shared value types.                                                                                               |

Business state lives in feature components using `useReducer` with a pure reducer beside the component.
Generic state and effects live in hooks. Language is the only cross-tree state; only features read its
context. Fumadocs integration stays in the docs and i18n features. The unchanged CSS files live in components beside the UI; the router
entry, generated route tree, ambient declarations, and architecture test remain at the source root.
Landing UI stays in `components/landing/` so the original CSS source directives still resolve.

`src/architecture.test.ts` scans imports, re-exports, dynamic imports, and TypeScript import types using
the parser already exposed by Vite. Failures name the rule:

- `components-pure-ui` / `components-no-state`: UI cannot import features, hooks, routes, or virtual
  business data, or use state/effect/context hooks. `useId` is allowed for markup IDs.
- `hooks-independent` / `hooks-no-jsx`: hooks cannot import features, components, or routes, or render JSX.
- `lib-independent`: lib imports stay inside lib.
- `features-no-routes`: features cannot import routes.
- `feature-public-entry`: another feature is accessed through its `index.ts`; add an entry only when
  another feature needs it, and export only those consumers' dependencies.

Tests live beside their modules. Build-time code lives with its feature: `features/docs/write-search-index.ts` writes the search indexes and
`features/landing/facts-plugin.ts` provides the landing page's build-time facts; generated output stays in
`dist/`.
The base-path helper test lives at `src/site.test.ts`, outside the pure lib boundary, so lib does not
import the test runner.

## Builds

`SITE_BASE_PATH` defaults to `/agent-kit`; Vite reads it at build time and supplies `BASE_URL` to the
router, links and static search. Trailing slashes are normalized by `src/lib/site.ts`. A future custom
domain can use `SITE_BASE_PATH=/`. The inline language script is URL-independent and restores the
same preference at either the project path or the domain root.

```bash
pnpm --filter website... run build
node apps/website/scripts/static-nav-check.mjs

# For a custom domain, build and check with the same base path:
SITE_BASE_PATH=/ pnpm --filter website... run build
SITE_BASE_PATH=/ node apps/website/scripts/static-nav-check.mjs
```

The navigation check serves the output under that base path, without an SPA fallback. It checks
landing → docs → guide → API navigation, language changes and both search indexes.
Each build overwrites `dist/client`, so check one build before creating the next. `CHROME` can name
the Chrome executable in an environment where headless Chrome is permitted. The check keeps the
Linux runner flags needed to start Chrome on Ubuntu.

## Publishing and maintainer setup

Set **Settings → Pages → Build and deployment → Source: GitHub Actions**. Production is published at
`https://perfectpan.github.io/agent-kit/`. Retain the `github-pages` environment's deployment restrictions,
branch rules and fork workflow approval requirements.

- `Pages` (`pages.yml`) builds PRs, manual runs and pushes to `main` with the production base path
  `/agent-kit`, then runs the static navigation check. The build job has only `contents: read` and
  checkout does not persist credentials. PRs and manual runs only build and check.
- The PR paths filter includes website/API/package sources, workspace inputs and the Pages workflow.
  It avoids installing dependencies for unrelated PRs; `CI` stays unfiltered and is the required
  check. Do not make the filtered Pages job required. GitHub's native paths filter has a 300-file
  diff limit; split large PRs when a relevant path falls outside that diff.
- Pushes to `main` and manual runs on `main` upload `apps/website/dist/client` as the Pages artifact. Pages
  serves the artifact as is (no Jekyll), so no `.nojekyll` file is needed. Artifacts expire after three days;
  rerun the workflow if one has expired.
- The separate deploy job depends on a successful build and runs for pushes and manual runs on `main`. It uses
  `actions/deploy-pages` with `pages: write` and `id-token: write`, targets the `github-pages`
  environment, and reports the deployed URL from the action output. It needs no source checkout.
- PRs cancel stale runs. Main runs are not canceled in progress, and the `pages-deploy` job concurrency
  group serializes deployment with cancellation disabled and `queue: max`.

For fork PRs, a maintainer must review code and workflow changes before approving GitHub's
**Approve and run workflows** prompt when required by repository policy. The build receives no
write permissions or repository secrets.

If deployment fails, inspect the run and rerun it after fixing the prerequisite. A successful build
alone does not establish that the site is live; confirm the deploy job and its reported URL.
