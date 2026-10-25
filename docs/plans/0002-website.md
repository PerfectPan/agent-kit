# Project website

- Status: in review (implemented; the owner still sets GitHub Pages → Source to GitHub Actions)
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
| Deployment | `.github/workflows/pages.yml`: build on pull requests, deploy on `main` with `actions/deploy-pages`, base path `/agent-kit/` | Default GitHub Pages address |

## 3. Risks to settle first

1. TanStack Start and Fumadocs under the `vite@* → vite-plus-core` override.
2. TypeDoc's TypeScript peer (≤ 6.0) against the catalog's TypeScript 7 with `strictPeerDependencies: true`.
3. Static prerendering of every route in both languages under the `/agent-kit/` base path.

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
- Delivered: `pages.yml` builds on pull requests and `workflow_dispatch`, and deploys on a push to `main`. W7 on
  GitHub still needs Settings → Pages → Source: GitHub Actions.

### 4.3 Rollback

Each task is its own commit; reverting `apps/website` and the workspace glob removes the site without touching the
packages.

## 5. Open items

Decided after Task 3: the package READMEs stay. The site does not replace them.

Still open:

- Long signatures on API pages scroll horizontally at 1440 px.
- The browser playground stays out of scope, with a custom domain and request-time server rendering.
- Add the site URL to the root README once the first deploy is live (the README is being rewritten in a separate pull request).
