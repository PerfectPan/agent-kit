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
context. Fumadocs integration stays in the docs and i18n features. The router entry, generated route
tree, ambient declarations, and architecture test remain at the source root.

`src/architecture.test.ts` scans imports, re-exports, dynamic imports, and TypeScript import types using
the parser already exposed by Vite. Failures name the rule:

- `components-pure-ui` / `components-no-state`: UI cannot import features, hooks, routes, or virtual
  business data, or use state/effect/context hooks. `useId` is allowed for markup IDs.
- `hooks-independent` / `hooks-no-jsx`: hooks cannot import features, components, or routes, or render JSX.
- `lib-independent`: lib imports only lib and npm packages other than React.
- `features-no-routes`: features cannot import routes.
- `feature-public-entry`: another feature is accessed through its `index.ts`; add an entry only when
  another feature needs it, and export only those consumers' dependencies.

Tests live beside their modules. Build-time code lives with its feature: `features/docs/write-search-index.ts` writes the search indexes and
`features/landing/facts-plugin.ts` provides the landing page's build-time facts; generated output stays in
`dist/`.
The base-path helper test lives at `src/site.test.ts`, outside the pure lib boundary, so lib does not
import the test runner.

## Styling

Styles are Tailwind CSS v4 utilities on the elements that render them. A component that styles by
state receives that state as a prop or reads it from an `aria-*` or `data-*` attribute through a
variant; it does not hold state for styling. The stylesheets live in `src/components/`:

| File          | Contents                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `theme.css`   | The shared `@theme`: fonts, colours, type scale (`text-display`, `text-body-sm`, `text-ui`, …), radii, shadows, easings and the `animate-*` keyframes.             |
| `landing.css` | Linked by the landing route only. Scans the landing UI and features; defines the `phone` (≤640 px), `narrow` (≤900 px) and `zh` variants and the `reveal` utility. |
| `app.css`     | Linked on every route. Fumadocs palette, and rules for Fumadocs and MDX output that takes no class: code blocks, prose headings and links, sidebar and TOC parts.  |

`app.css` excludes the landing folders from its sources, so landing utilities stay out of the docs
stylesheet. Each remaining CSS rule carries a comment saying why it is not a utility. Tailwind's
scanner reads class names literally: write complete class strings, and pick between them in code
rather than building them from fragments.

`src/architecture.test.ts` enforces this (`styles-in-tailwind`): a stylesheet outside the three above fails, and so
does a selector naming a class other than the ones that come from outside the markup (`dark`, `prose`, `shiki`, …).

Controls come from [shadcn/ui](https://ui.shadcn.com) (`components.json`): `src/components/ui/` holds `Button`,
`ToggleGroup` and `Tabs`, built on Radix primitives. Site looks are variants in those files (`Button`'s `card`,
`ghost` and `chip` variants, `ToggleGroup`'s `paper`, `sidebar` and `code` surfaces) rather than class strings
elsewhere; add a variant when a control repeats, and write utilities in place for one-off markup. shadcn's semantic
colours (`background`, `primary`, `muted-foreground`, …) are set from the palette in `theme.css`, with the docs dark
values in `app.css`. The components skip shadcn's React context, which `components/` may not read, so a toggle
group's items take the variant too.

Combine classes with `cn()` from `src/lib/utils.ts` (clsx plus tailwind-merge), not template strings: a later class
replaces an earlier one for the same property. tailwind-merge knows the theme's custom scales from the list in
`utils.ts`; add a new size, shadow, radius, easing or animation token there as well. A font-size utility also sets
the line height, so put a size before the `leading-*` it should keep. `cva()` maps props to classes for local
variants and lookup tables.

`pnpm run lint` runs `eslint-plugin-better-tailwindcss` in oxlint over `className`, `cn()`, `cva()` and `clsx()`.
It reports unknown, conflicting, duplicate and non-canonical classes and stray whitespace, checking the landing
folders against `landing.css` and everything else against `app.css` (`vite.config.ts`). Class order is not enforced:
`vp fmt` does not sort classes.

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
