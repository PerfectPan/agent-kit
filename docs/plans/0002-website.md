# Project website

- Status: in review (Task 11 main-only deployment; GitHub acceptance pending)
- Owner: PerfectPan
- Reviewer: unconfirmed
- Last updated: 2026-10-29
- Paired Spec: [docs/specs/0002-website.md](../specs/0002-website.md)

## 1. Background and goals

### 1.1 Current behavior and constraints

agent-kit has no website; the root README and `packages/agent-kit/README.md` carry all documentation. The repository is
a pnpm 12 workspace with a strict catalog (`pnpm-workspace.yaml`), TypeScript 7, Vite+ (`vp`) for build, lint, test and
format, and an override that redirects every `vite@*` dependency to `@voidzero-dev/vite-plus-core`. Every workspace
project defines `build`, `lint`, `typecheck`, `test`, `format` and `format:check`.

### 1.2 Goals and success criteria

The Spec scenarios W1–W8 pass on the deployed site, and `pnpm run check` stays green with the website in the workspace.

### 1.3 Non-goals

The browser playground, a custom domain, server-side rendering at request time.

## 2. Design decisions

| Decision | Choice | Reason |
| --- | --- | --- |
| Location | `apps/website`, a private workspace project (`"private": true`), added to `pnpm-workspace.yaml` as `apps/*` | Keeps the site next to the code it documents; it is not published and has no changeset |
| Framework | TanStack Start (React) with static prerendering | Owner's choice; prerendered HTML deploys to GitHub Pages |
| Docs | Fumadocs (`fumadocs-core` with its TanStack adapter, `fumadocs-ui`, `fumadocs-mdx` Vite plugin) | Docs layout, search and i18n out of the box; TanStack support |
| i18n | Language is client state (`ak-lang`); one URL per page (`/`, `/docs/...`); Fumadocs i18n for docs collections; one `t(en, zh)`-style dictionary for the landing page | Spec W1, W4 |
| Styling | Tailwind CSS v4 with the tokens of the approved mockup (paper `#fbf7f2`, ink `#2a211e`, ochre `#b94f3c`, honey `#e3a93b`, event colours), Bricolage Grotesque and JetBrains Mono self-hosted | Approved visual direction; no third-party requests at runtime |
| Landing page source | The approved mockup `site.html` (kept outside the repository, path given to the implementer) ported to React components | Single visual reference |
| Mascot | The ribbon mascot as one SVG React component with `idle`, `working` and `blocked` states | Approved identity |
| Data | Entry size budgets read from `packages/*/.size-limit.ts` and the support table from `builtinProviders` at build time | Spec: no hand-written numbers |
| API reference | Generated from the built `.d.ts` of the published packages. First choice: TypeDoc + `typedoc-plugin-markdown` into MDX, with TypeScript 6 pinned for TypeDoc only through a scoped override; fallback: `fumadocs-typescript` (TypeScript 7 based) | TypeDoc supports TypeScript ≤ 6.0; to be confirmed in Task 1 |
| Deployment | `pages.yml` builds and checks every eligible event; only pushes to `main` upload a Pages artifact and deploy in a separate job. Pages source is **GitHub Actions** | The owner dropped PR previews: native Pages PR previews are alpha-only and not public, and a dedicated publishing branch is not wanted |

## 3. Risks to settle first

1. TanStack Start and Fumadocs under the `vite@* → vite-plus-core` override.
2. TypeDoc's TypeScript peer (≤ 6.0) against the catalog's TypeScript 7 with `strictPeerDependencies: true`.
3. Static prerendering of every route in both languages under the `/agent-kit/` base path.
4. A maintainer must set the Pages source to **GitHub Actions** and retain the `github-pages`
   environment's deployment restrictions. Live deployment acceptance remains outstanding.
5. Fork PRs build untrusted code with only `contents: read`, without persisted checkout credentials.
   Retain repository workflow approval requirements. Only the separate main-push deploy job receives
   `pages: write` and `id-token: write`; PR and manual runs cannot upload or deploy the site.

A risk that cannot be solved without weakening a repository policy (catalog strictness, the vite override, peer
strictness) stops the batch and goes back to the owner.

## 4. Execution plan

### 4.1 Completion contract

Each task ends with the listed exit condition passing and a handoff note in `apps/website/HANDOFF.md`: what changed,
decisions taken, open issues. The coordinator reviews every batch before the next starts.

### 4.2 Tasks

#### Task 1: Scaffold and risk spike

- Files: `apps/website/**`, `pnpm-workspace.yaml` (workspace glob, catalog entries), `pnpm-lock.yaml`.
- Change: TanStack Start app with Fumadocs, one landing route with a placeholder, one docs page in English and
  Chinese, static prerender under `/agent-kit/`; the six workspace scripts.
- Exit condition: `pnpm install` from the root succeeds; `pnpm --filter website build` writes static HTML for `/`,
  `/zh`, `/docs/...` and `/zh/docs/...`; `pnpm run check` passes; risks 1 and 3 answered in the handoff note.
- Delivered: TanStack Start and Fumadocs in `apps/website`, prerendered under `/agent-kit/`. The vite override and
  static prerender both worked.

#### Task 2: Landing page

- Files: `apps/website/src/routes/**`, `apps/website/src/components/landing/**`.
- Change: port the approved mockup section by section (hero with the code demo, layer, connection and coordination,
  built with agent-kit, built-in providers, guides and API reference, footer); mascot component; generated sizes and
  support table.
- Tests: unit tests for the demo state (W2), the dictionary having every key in both languages (W1).
- Exit condition: W1, W2, W3, W6, W8 checked in a browser at 1440 and 390 px, light theme, both languages.
- Delivered: landing page in both languages, with the mascot, size budgets, and the provider table.

#### Task 3: Guides

- Files: `apps/website/content/docs/{en,zh}/**`.
- Change: guides moved from `packages/agent-kit/README.md` and `packages/agent-kit-collab/README.md` (one page per
  task), Chinese translations.
- Exit condition: W4.
- Delivered: guides from the two package READMEs, with Chinese translations. The package READMEs stay.

#### Task 4: API reference

- Files: `apps/website/scripts/**`, generated MDX location (ignored by git).
- Change: generator from the built declarations, risk 2 answered.
- Exit condition: W5 for every public entry.
- Delivered: `website-api` generates 21 pages (20 public entries plus the index) with TypeDoc. TypeScript 6 is only
  `catalogs.typescript6`.

#### Task 5: Deployment

- Files: `.github/workflows/pages.yml`, docs.
- Exit condition: W7 on GitHub.
- Deployment uses the Actions artifact. Task 11 keeps publication limited to main pushes;
  GitHub setup and acceptance follow the website README.

#### Task 10: Separate website features, UI, and effects

- Scope: restructure `apps/website/src` without changing behavior, DOM, styles, copy, URLs, timings,
  keyboard controls, or prerendered output. No package, dependency, or policy changes.
- Decisions: routes render feature pages; the landing, demo, layer, docs, and i18n features own business
  data and composition. Pure reducers own business selections and demo phases. Generic state, timers,
  language persistence, observation, and measurement move to JSX-free hooks; UI receives props and
  callbacks. Pure generic helpers remain in lib. Cross-feature imports use explicit index entries.
- Order: preserve the existing homepage baseline; relocate modules and adjacent tests; separate UI and
  effects; add reducer regression tests and named architecture checks; document the boundaries in the
  website README and append the delivery evidence to HANDOFF.
- Compatibility: retain the dual language tree, rendered node order, timer delays and cancellation,
  keyboard focus, and existing Fumadocs integration. CSS files and class names stay unchanged.
- Exit: website typecheck, lint, format:check, test, dependency-inclusive build, normalized homepage
  comparison, static navigation check (or a concrete sandbox blocker), and root `pnpm run check`.
  Record exact commands and final output lines. Deliver local edits for coordinator review, without
  commits or pushes.
- Review status: source separation and website checks/build are implemented. Strict whole-HTML parity
  remains open because shared chunks/preloads and hydration timestamps differ; all 43 prerendered page
  bodies match a clean HEAD build. Browser startup and the root process-identity tests are blocked in
  the current sandbox. Task 10's HANDOFF records the exact evidence and remaining acceptance work.

### 4.3 Rollback

Each task is its own commit; reverting `apps/website` and the workspace glob removes the site without touching the
packages.

#### Task 11: Main-only Pages deployment

- Scope: `.github/workflows/pages.yml`, removal of preview automation and UI, website build inputs,
  and website documentation. No commits, pushes, package edits, dependency changes, or policy relaxation.
- Decision: drop PR previews because GitHub's native support is alpha-only and unavailable publicly
  ([upstream input definition](https://github.com/actions/deploy-pages/blob/main/action.yml)); the owner
  does not want a dedicated publishing branch. Set the Pages source to **GitHub Actions**.
- Workflow: keep the event-level paths filter for website/API/package/workspace inputs and keep CI
  unfiltered. PRs, manual runs and main pushes build at `/agent-kit` and run the static navigation
  check. The build job has only `contents: read`. A push to main, or a manual run on main, uploads
  `apps/website/dist/client` (served as is, without Jekyll). A separate deploy job depends on build, runs
  for those main runs, uses `actions/deploy-pages`, and targets `github-pages` with `pages: write`
  and `id-token: write`.
- Concurrency: PRs cancel stale runs; main runs are not canceled in progress. The `pages-deploy`
  job group serializes deployments with cancellation disabled and `queue: max`.
- Build/UI: remove preview metadata, banner, feature, environment input and preview-only tests.
  Keep the pure `SITE_BASE_PATH` helper and regression tests; default to `/agent-kit` and support
  `/` for a future custom domain. Keep the navigation check's Linux Chrome flags.
- Order: update the workflow; delete preview workflow, deployment helpers and their tests/support;
  remove preview UI and input handling; update base-path test fixtures and current-state docs;
  run website/scripts gates, dependency-inclusive website build, static navigation, workflow YAML
  parsing and the full repository check.
- Exit: no obsolete preview references outside history and HANDOFF; website and scripts typecheck,
  lint, format:check and test pass; `pnpm --filter website... run build` and `pnpm run check` pass,
  or concrete sandbox blockers are recorded. Deliver local edits with exact results for coordinator
  review. No repository setting changes or remote publication are authorized.
- Rollback: revert this batch's workflow, website and documentation changes together; do not change
  repository settings or deploy during the local implementation.
- Local result: website and scripts typecheck, lint, format:check and test pass (75 and 48 tests).
  The dependency-inclusive website build produces 43 HTML pages and both search indexes; workflow
  YAML and repository checks pass. Static navigation times out before Chrome exposes its debugging
  endpoint. The full repository gate passes formatting, build, lint and typecheck, then stops at three
  existing process-identity tests with `spawnSync /bin/ps EPERM`; remaining tests and package checks
  need an unrestricted environment. See the main-only deployment section in HANDOFF for exact commands.

#### Task 13: Tailwind styles

- Scope: rewrite the landing stylesheet (1599 lines) and the docs stylesheet (236 lines) as Tailwind v4
  utilities in the JSX that renders each element. Rendering, DOM structure (apart from class and data
  attributes), copy, URLs, timings, keyboard handling and reduced-motion handling stay as they were. No
  new dependencies; the website is private, so no changeset.
- Decisions: `components/theme.css` holds the shared `@theme` (colours, fonts, type scale with line
  heights and weights, radii, shadows, easings, `animate-*` tokens with their keyframes) and is imported
  by both stylesheets; Tailwind emits only the tokens a page uses. `landing.css` keeps the landing-only
  link, adds `phone`/`narrow` variants with inclusive max-width queries (Tailwind's `max-*` exclude the
  boundary), a `zh` variant for the Chinese tree, the `reveal` utility (useInView toggles plain classes)
  and the `body:has(.landing-langs)` rule (the root shell renders `<body>`). `app.css` keeps the
  Fumadocs palette, `.dark #nd-sidebar` (overrides an ID selector in the Fumadocs theme), Shiki and
  prose rules for MDX output, and sidebar/TOC internals; it excludes the landing folders from its
  sources. The docs title, body and sidebar take utilities through Fumadocs `className` props.
  State-dependent classes are chosen in code from props (`lang`, selection, agent kind) or through
  `aria-pressed`/`aria-selected`/`group-*` variants; the mascot takes a `quiet` prop for the docs
  sidebar. Unused colour tokens and the `.ev` rules, which matched no element, are dropped.
- Exit: headless-Chrome screenshots of the landing page (1440 and 390 px, both languages, reveals
  shown), hero task/agent/raw/blocked states, layer and card hover, tab focus, the cost docs page in
  both languages and dark, the API page and 390 px docs differ from a build of the previous commit in
  under 0.5% of pixels, with every image above 0.05% explained; `scrollWidth` equals the viewport at
  390/768/1440 px in both languages; with reduced motion the landing page runs no animations; website
  format:check, lint, typecheck, test, the dependency-inclusive build and the static navigation check pass.
- Result: the largest difference is 0.0755% (390 px English landing page, the task tab labels), which
  matches the 0.0765% two baseline captures differ by; all other images differ by at most 0.0056%,
  in antialiased text and rounded-corner edges. CSS sources drop from 1835 to 392 lines (`theme.css` 187, `app.css` 160,
  `landing.css` 45); built CSS grows from 53.3 to 60.5 KB on the landing page and from 114.5 to
  117.0 KB on every page.
- Follow-up: controls come from shadcn/ui (`components/ui`: `Button` with site variants, single-choice
  `ToggleGroup` for the language and fields/raw switches, Radix `Tabs` for the hero tasks) and classes are
  combined with `cn()` (clsx and tailwind-merge, extended with the theme's scales) instead of class-string
  constants and template strings. `eslint-plugin-better-tailwindcss` runs in oxlint as a JS plugin and fails
  on unknown, conflicting, duplicate and non-canonical classes.

## 5. Open items

Decided after Task 3: the package READMEs stay. The site does not replace them.

Still open:

- Verify that main deployments never overlap. The Pages source is GitHub Actions; a main push builds,
  runs the static navigation check and deploys, and fork PRs only build.
- Revisit PR previews when the `actions/deploy-pages` `preview` input becomes publicly available.
- Run the full repository gate where process-identity tests may invoke `/bin/ps`, and record the result
  in Task 11's HANDOFF section.
- Long signatures on API pages scroll horizontally at 1440 px.
- The browser playground stays out of scope, with a custom domain and request-time server rendering.
