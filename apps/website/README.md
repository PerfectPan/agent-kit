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

Tests live beside their modules. `features/docs/build/` contains source adapters for search export and
the landing-facts Vite plugin; generated output stays in `dist/`. The source directory is explicitly
included in Git despite the repository's generic `build/` ignore.
