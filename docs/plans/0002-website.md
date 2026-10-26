# Project website

- Status: in review (Task 11 local implementation; GitHub acceptance pending)
- Owner: PerfectPan
- Reviewer: unconfirmed
- Last updated: 2026-10-25
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
| Deployment | Read-only `pages.yml` builds; trusted writers publish `main` to the `gh-pages` root and PRs to `pr-preview/pr-<number>/`; Pages uses that branch's root | One GitHub Pages site with isolated publication paths; main preserves previews |

## 3. Risks to settle first

1. TanStack Start and Fumadocs under the `vite@* → vite-plus-core` override.
2. TypeDoc's TypeScript peer (≤ 6.0) against the catalog's TypeScript 7 with `strictPeerDependencies: true`.
3. Static prerendering of every route in both languages under the `/agent-kit/` base path.
4. Branch publication with `GITHUB_TOKEN` does not trigger Pages. The owner-approved permission
   supplement (`actions: read` for artifact download; `pages: write` for explicit build requests) is
   implemented; the Pages branch setting and live acceptance remain outstanding.
5. A fork artifact is untrusted data. Validate metadata and paths without running code, bind it to the
   source run and current PR through GitHub APIs, and serialize all writes and cleanups. Same-origin
   preview JavaScript is still public executable content for visitors; noindex is not access control.

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
- Exit condition: W7 on a fork.
- Delivered initially through the Actions artifact. Task 11 replaces that delivery with branch
  publication; GitHub setup and acceptance now follow the website README.

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

#### Task 11: Pull request previews

- Scope: website build inputs, `.github/workflows/pages*.yml`, trusted Pages deployment helpers,
  and website documentation. No commits, pushes, package edits, dependency changes, or policy relaxation.
- Decisions: publish `main` to the `gh-pages` root and preserve `pr-preview/`; publish each PR to
  `pr-preview/pr-<number>/`. Use event-level paths filters for website/API/package/workspace inputs,
  keeping CI unfiltered. The Pages build has only `contents: read`; a separate default-branch
  `workflow_run` consumes the artifact as data. Resolve fork PRs by head SHA through the API when
  the event has no PR list. Reject invalid metadata, unsafe archive entries, and unrelated PRs;
  skip stale heads and closed PRs. Close events use trusted code only.
- Concurrency: every branch writer uses `pages-gh-pages` with cancellation disabled and `queue: max`,
  so unrelated PR cleanups do not replace one another in the pending queue. Recheck PR state/head
  before writing, and preserve sibling previews on every operation.
- Review revision: port deployment automation and its regression tests to the private `scripts/`
  TypeScript project. The CLI is `scripts/pages-preview.ts`; publishing and archive validation live
  under `scripts/lib/` with adjacent tests. Use only Node built-ins and fetch so privileged jobs can
  sparsely check out trusted default-branch `scripts` and `.node-version`, set up Node, and run without
  installing dependencies. Retain metadata, archive, fork identity, state, comment and directory checks.
  Add the approved `actions: read` to publishers and `pages: write` to all writers, with inline reasons;
  keep the PR build at `contents: read`. Request a Pages build even on an unchanged rerun after an
  earlier build-request failure. Verify the scripts gates, both website builds/gates and workflow YAML.
- Build/UI: normalize `SITE_BASE_PATH` in a pure lib helper; Vite supplies the client base URL.
  `SITE_PREVIEW_PR` adds noindex metadata and a slim preview banner through a feature and pure UI.
- Order: implement and test base paths/UI; implement read-only artifact creation and trusted publishing;
  add hostile-artifact/state regression checks; document setup and fork approval; run both builds,
  navigation checks, website gates, full repository check, and workflow YAML validation.
- Exit: append exact results and GitHub-only acceptance checks to HANDOFF. The owner approved the
  Actions read / Pages write supplement; no repository setting or remote publication is authorized.
- Local result: scripts typecheck/lint/formatting and 102 tests pass, including 59 Pages cases; direct
  Node execution also passes in a sparse runtime copy without installed dependencies. Website
  typecheck/lint/formatting and 77 tests pass; production and preview builds each produce 43 pages
  with verified base paths, search indexes and preview metadata. Workflow YAML parses. Chrome still
  times out before navigation and `/bin/ps` is still denied; browser acceptance and the full root gate
  remain for an unrestricted environment. See Task 11's HANDOFF for exact commands and GitHub checks.

## 5. Open items

Decided after Task 3: the package READMEs stay. The site does not replace them.

Still open:

- Set Pages to `gh-pages` / root after the branch exists. Verify real fork builds (including empty
  `workflow_run.pull_requests`), stale/closed run rejection, one-comment updates, production preview
  preservation, concurrent PR publication and close cleanup on GitHub; local YAML parsing cannot prove them.
- Run both static-navigation variants where Chrome can start, and the full repository gate where
  process-identity tests may invoke `/bin/ps`. Record current results in Task 11's HANDOFF section.
- Long signatures on API pages scroll horizontally at 1440 px.
- The browser playground stays out of scope, with a custom domain and request-time server rendering.
- Add the site URL to the root README once the first deploy is live (the README is being rewritten in a separate pull request).
