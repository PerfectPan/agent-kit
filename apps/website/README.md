# Website

Private TanStack Start and Fumadocs site. Source is organized by responsibility:

| Folder            | Responsibility                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/routes/`     | Route definitions rendering feature pages; loaders and head functions may call features.                                                                           |
| `src/features/`   | Business rules, data, copy, reducers, and component composition, grouped into `landing`, `demo`, `layer`, `docs`, `i18n`, and `preview`. Small features stay flat. |
| `src/components/` | Pure UI: props in, markup out, callbacks for events. Copy, selections, clipboard flags, and animation state come from features.                                    |
| `src/hooks/`      | Business-independent state and effects: language context and persistence, motion, visibility, clipboard, timers, focus, and DOM measurement. No JSX.               |
| `src/lib/`        | Business-independent pure helpers and shared value types.                                                                                                          |

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

Tests live beside their modules. `features/docs/build/` contains source adapters for search export and
the landing-facts Vite plugin; generated output stays in `dist/`. The source directory is explicitly
included in Git despite the repository's generic `build/` ignore.
The base-path helper test lives at `src/site.test.ts`, outside the pure lib boundary, so lib does not
import the test runner.

## Builds and pull request previews

`SITE_BASE_PATH` defaults to `/agent-kit`; Vite reads it at build time and supplies `BASE_URL` to the
router, links and static search. Trailing slashes are normalized by `src/lib/site.ts`. The inline
language script is URL-independent and restores the same preference under either base path.
`SITE_PREVIEW_PR` is empty in production; a positive PR number enables `noindex` metadata and the
slim "Preview of #<number>" banner. Preview composition lives in `features/preview`, with props-only
markup in `components/preview-banner.tsx`.

```bash
SITE_BASE_PATH=/agent-kit pnpm --filter website... run build
SITE_BASE_PATH=/agent-kit node apps/website/scripts/static-nav-check.mjs

SITE_BASE_PATH=/agent-kit/pr-preview/pr-215 SITE_PREVIEW_PR=215 pnpm --filter website build
SITE_BASE_PATH=/agent-kit/pr-preview/pr-215 SITE_PREVIEW_PR=215 node apps/website/scripts/static-nav-check.mjs

pnpm --filter repo-scripts test
```

The navigation check serves the output under that base path, without an SPA fallback. It checks
landing → docs → guide → API navigation, language changes, both search indexes and preview metadata.
Each build overwrites `dist/client`, so check one build before creating the next. `CHROME` can name
the Chrome executable in an environment where headless Chrome is permitted.

### Publishing and maintainer setup

The publishing source is `gh-pages`: production files occupy the root, while previews occupy
`pr-preview/pr-<number>/`. Production updates preserve the entire preview directory. A PR's URL is
`https://perfectpan.github.io/agent-kit/pr-preview/pr-<number>/`.

One time, after `gh-pages` exists, a maintainer sets **Settings → Pages → Build and deployment →
Source: Deploy from a branch → Branch: gh-pages → /(root)**. The preview workflow and trusted
`scripts/pages-preview.ts` and its `scripts/lib/pages-*.ts` helpers must exist on the default branch
before `workflow_run` can publish previews. All three writers sparsely check out `scripts` and
`.node-version` from that branch, use `actions/setup-node` with that version file, and run
`node scripts/pages-preview.ts main|preview|cleanup` without a dependency install. The helper imports
only Node built-ins and uses fetch for GitHub API calls; its tests live beside the library modules.
Do not weaken branch rules, fork workflow approval requirements, or secret restrictions to enable it.

- `Pages` (`pages.yml`) builds PRs with only `contents: read`, without secrets or persisted checkout
  credentials. The event-level paths filter includes website/API/package sources, workspace inputs
  and Pages automation. It avoids installing dependencies for unrelated PRs; `CI` stays unfiltered
  and is the required check. Do not make the filtered Pages job required. GitHub's native paths
  filter has a 300-file diff limit; split large PRs when a relevant path falls outside that diff.
- Successful builds upload `pages-site`: `site/` plus `metadata.json` containing the PR number and
  head SHA. Main builds use production inputs; manual runs only build. Artifacts expire after three
  days; rerun the build if one has expired.
- `Pages preview` runs trusted default-branch code after a successful PR build. It validates the
  archive before writing files: bounded size, regular files only, no traversal, symlinks or Git
  control files. It checks metadata against the triggering SHA, resolves fork PRs using the commit's
  associated-PR API when the event PR list is empty, and verifies the base repository, head repository,
  branch, current head and open state. It never installs dependencies or executes artifact contents.
  The ZIP reader accepts the single-disk stored/deflated format emitted by `upload-artifact`, including
  streaming data descriptors; encrypted, ZIP64 and unsupported compression formats are rejected.
  Downloads and inflated content are capped at 256 MiB and archives at 20,000 entries; metadata is
  capped at 1 KiB. CRC and local-header checks run before any file is written. Storage redirects
  receive no GitHub authorization header.
- Main publishing, preview publishing and close cleanup share the `pages-gh-pages` concurrency group
  with `queue: max` and cancellation disabled. They fetch the current branch inside that lock, recheck
  PR state/head before writing, and use fast-forward pushes. The queue holds up to 100 pending jobs;
  rerun any job GitHub cancels when the queue is full. A failed push is not force-pushed.
- Preview comments are updated using `<!-- agent-kit-pages-preview -->` and the `github-actions[bot]`
  author. On `pull_request_target: closed`, trusted default-branch code removes only that PR's folder
  and updates its existing comment. Reopened PRs are not removed; stale builds cannot restore a
  closed PR. A new build recreates a reopened PR's preview.

For fork PRs, a maintainer must review the code and workflow changes before approving GitHub's
**Approve and run workflows** prompt when required by repository policy. Approval permits building
untrusted code and publishing its static JavaScript. No write token or secret is passed to that build.
The privileged stage uses only the repository token, not a contributor token or a new secret.

Production and preview publishers have the approved `actions: read` permission for artifact downloads;
all three writers have `pages: write` for `POST /repos/{owner}/{repo}/pages/builds`. A `GITHUB_TOKEN`
push does **not** trigger a branch Pages build, so the helper explicitly requests one after publication
or cleanup, including unchanged reruns after a previous request failed. Cleanup before `gh-pages`
exists needs no build. The PR build retains only `contents: read`. A successful request queues a build;
it does not establish that the site is already live. See [GitHub's branch publishing limitation](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site#troubleshooting-publishing-from-a-branch)
and [Pages build request permissions](https://docs.github.com/en/rest/pages/pages#request-a-github-pages-build).

Previews are public and share the production origin, including browser storage; they are not a
security sandbox. `noindex` discourages indexing but does not control access. Artifact validation
protects the privileged runner and publication paths, not visitors from arbitrary preview JavaScript.
If a deployment or cleanup fails, inspect the run and rerun it after fixing the prerequisite; the
previous published files remain until a successful branch update and Pages publication.
