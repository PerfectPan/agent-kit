# Agent Guidelines

This repository is intended to become a maintainable, publishable project. Treat every change as if it may be reviewed, packaged, indexed, and installed by users.

## Working Rules

- Keep changes scoped to the user request and nearby code.
- Prefer existing project patterns over new abstractions.
- Do not commit local config, credentials, generated logs, temporary workspaces, build artifacts, or machine-specific paths.
- Do not add private tokens, internal hostnames, private repository names, or personal filesystem paths.
- Use `rg` for searches when available.
- Update tests and documentation when behavior changes.

## Project-Specific Commands

This is a Rush + pnpm TypeScript monorepo. Rush pins its own version and pnpm in `rush.json`; the root
`package.json` only holds shortcuts that call `common/scripts/install-run-rush.js`, so `npm run <script>` works
without a global Rush or pnpm install. Node comes from `.node-version`.

```bash
# Install local Git hooks (pre-commit repository checks, pre-push blocks direct pushes to main):
./scripts/install-git-hooks.sh

# Install dependencies from the committed lockfile (CI does the same):
node common/scripts/install-run-rush.js install

# After adding or changing a dependency in any package.json:
node common/scripts/install-run-rush.js update

# Aggregate gate: format:check, build, lint, typecheck, test, check:package:
npm run check

# Individual gates (Rush bulk commands run in every project):
npm run format        # or format:check
npm run build         # rush rebuild: internal packages have no build step, so an incremental build would skip
                      # the shell after an internal-package change
npm run lint          # oxlint with type-aware rules and TypeScript diagnostics
npm run typecheck
npm run test          # includes the architecture boundary test in infra/architecture
npm run check:package # after build: publint, attw (ESM-only), size-limit and the dist check of the shell

# Record a release note for changed packages, then verify one exists (CI runs the verify step on PRs):
npm run change
npm run change:verify

# Release identity check and publish dry run (never add --publish locally):
npm run release:check -- vX.Y.Z --repository OWNER/REPO
npm run publish:dry-run

# Repository, PR/MR title and description checks:
gh repo-checks repository
gh repo-checks pr-title "docs: update project template"
gh repo-checks pr-body pr-body.md

# GitHub repository setup dry run:
gh repo-checks protect --repo OWNER/REPO
```

Rush projects are listed in `rush.json`:

- `packages/agent-kit` is `@rivus/agent-kit`, the published shell. Its `src/<entry>.ts` files only re-export names,
  one by one, from internal packages' `public.ts` (or a lighter public sub-entry such as
  `@rivus/agent-kit-harness/public/events`); every subpath in its `exports` map is one tsdown entry, and tsdown
  bundles the internal packages and their declarations into `dist`.
- `packages/agent-kit-collab` is `@rivus/agent-kit-collab`, the second published package, with its own code: each
  entry lives in `src/<entry>/` (layers at `src/<entry>/<layer>/`, entry file `src/<entry>/public.ts`). It reaches
  `@rivus/agent-kit` only through the public entries listed in `boundaries.ts`, as a peer (`workspace:^`). Both
  packages are the `main` lockstep version policy: one version, one tag, one release.
- The other folders under `packages/`, such as `packages/platform`, are private internal packages named
  `@rivus/agent-kit-<folder>`, one per bounded context, with `"shouldPublish": false`. Each exports `src/index.ts`
  for sibling packages and `src/public.ts` for the shell, straight from TypeScript source, and is a `workspace:*`
  devDependency of the shell. Their tsconfig enables `isolatedDeclarations` because the shell's declaration bundler
  (Oxc) needs explicit types on exported declarations; keep exports whose type is only inferred, such as zod
  schemas, module-private.
- `infra/architecture` is the private `architecture-boundaries` project: `boundaries.ts` declares allowed package
  dependencies, layer rules, npm and Node built-in allowlists and the Effect allowlist; its test checks every
  package source file against them.
- `scripts/` is the private `repo-scripts` project for repository automation written in TypeScript and run directly
  by Node.
- `tests/smoke` is the private `agent-kit-smoke` project: smoke tests against the coding agents installed on this
  machine, run by hand with `npm run smoke` there (see its README). Its `test` script is empty, so CI never runs them.

Every project defines the `build`, `lint`, `typecheck`, `test`, `format` and `format:check` scripts that the Rush
bulk commands call. `docs/development/release.md` is the release runbook.

Do not claim implementation work is complete until the relevant commands pass, or until skipped commands are explained with concrete blockers.

## Development Workflow

For non-trivial changes:

1. Understand the requested behavior, affected domain concepts, ownership boundaries, and data flow.
2. Follow the Spec/Plan selection rules in `CONTRIBUTING.md`. Review required design artifacts before implementation. The Spec states required behavior; the Plan records technical decisions and the ordered tasks, tests, and exit conditions to execute. Do not start a Plan that is blocked on an unresolved decision. Migrate lasting constraints to current-state documentation.
3. Keep the implementation scoped to the task and nearby code.
4. Update tests and documentation when behavior, public contracts, or workflow expectations change.
5. Ensure local Git hooks are installed for the checkout when practical.
6. Run repository checks, title checks, and project-specific validation gates.
7. For a newly created GitHub repository, configure branch protection with `gh repo-checks protect --repo OWNER/REPO --check check --apply` (add `--approvals 0` for a single maintainer) using an admin-authorized account.
8. Open or update the PR/MR with a summary of what changed and why, the exact validation and skipped gates, and any risks.

## Releases

- A PR that changes a published package's source, manifest or build config, an internal package that the shell
  bundles, or the Rush lockfile, includes a Rush change file under `common/changes/`. A change in an internal package
  needs a change file for `@rivus/agent-kit`. Create it with `npm run change`; when Rush reports nothing to do (an
  internal-package or lockfile-only change), use `node scripts/release-intent.ts add --type <major|minor|patch|none> --message "<text>"`.
- Never bump versions, edit `CHANGELOG.json`/`CHANGELOG.md`, create release tags, or run `rush publish --publish`
  by hand. Every push to `main` runs both release workflows: `version-packages.yml` opens or updates the release PR
  while change files are pending, and once the merged release PR has consumed them, `publish-npm.yml` tags the
  release, creates the GitHub Release and publishes. Follow `docs/development/release.md`.
- Workspace dependencies between packages use `workspace:*`; pnpm replaces them with exact versions when packing.

## Repository Architecture

- `docs/architecture/authoring.md` is the authority for how a context package is laid out (`domain/` with one
  `adapters/` folder per concept, `application/`, `infra/`, `public.ts`, `index.ts`) and for the plain
  TypeScript and Effect rules;
  `CONTEXT.md` is the glossary. Change `infra/architecture/boundaries.ts` in the same PR as a new package,
  package dependency or npm import specifier (the allowlist matches exact specifiers such as `zod/mini`).
- Organize code by domain boundaries, layer boundaries, and test boundaries before mechanical one-file-per-export preferences.
- Keep domain rules, application services, infrastructure adapters, UI/CLI entrypoints, persistence, and test fixtures separated when those responsibilities exist.
- JavaScript or TypeScript projects take shared lint, format, and `tsconfig` rules from the `PerfectPan/lint-config` repository; see its README. Extend those shared configs instead of copying them.
- Do not introduce a shared abstraction unless it removes real duplication, clarifies a boundary, or matches an existing project pattern.
- When a file starts mixing multiple responsibilities or layers, split by responsibility rather than by arbitrary size.
- Substantial product behavior uses one Spec plus one detailed Plan. Technical refactors use a Plan. Record technical choices there before implementation.

## Documentation

- Keep `README.md` focused on orientation, quick start, and current user-facing behavior.
- Use `CONTRIBUTING.md` for contribution workflow.
- Use `docs/specs/` for active product behavior and `docs/plans/` for active technical decisions and detailed execution plans. Current-state documentation owns implemented behavior.
- Use `docs/` for durable current-state knowledge such as architecture, development guides, operational runbooks, references, and onboarding tutorials.
- Record user-facing changes with Rush change files (`npm run change`) in the same PR; do not edit generated changelogs or add a hand-written root `CHANGELOG.md`.
- When behavior, configuration, commands, APIs, deployment, architecture, or operations change, update the relevant docs in the same PR/MR or explain why no docs changed.

## AI Delivery Workflow

When an AI agent completes implementation work:

1. Inspect `git status --short --branch`.
2. Verify generated files, secrets, machine paths, and build artifacts are not staged.
3. Run the required verification gates and record the exact commands.
4. Commit pending changes with a concise conventional commit message.
5. Push the branch and verify the remote head.
6. Create or reuse a GitHub Pull Request when the task is not landing directly on `main`.
7. Include a delivery summary with what changed and why, validation, and remaining risks.

## Review Evidence

- PR/MR titles must be English and follow `type(scope): summary`, including bot-generated release and dependency PRs such as `chore(release): version packages`; use `gh repo-checks pr-title` to verify them.
- PR/MR descriptions must have a Summary (what changed and why) and a Validation section (exact commands and results, skipped gates with reasons); add Risks when there are any. Do not add agent attribution lines such as "Generated with <tool>". Verify the body with `gh repo-checks pr-body` before opening or updating the PR/MR. Bot-opened PRs are exempt from the description check, not the title check.
- If a claim depends on logs, screenshots, package output, deployed behavior, or generated artifacts, attach or link the evidence in the PR/MR.
- Update the PR/MR description after substantial code changes, review-driven revisions, rebases that change behavior, or validation reruns.
- Keep GitHub PR and GitLab MR templates in sync if the project uses both hosting styles.

## Git

- Branch names should be short and descriptive, such as `feat/release-source`.
- Commit messages should be concise and use conventional prefixes when they fit.
- Signed commits are preferred when local git signing is configured.
- Do not rewrite or discard user changes unless explicitly requested.

## Publish Safety Check

Before pushing public-facing or package-facing changes, scan for accidental private references. Adjust globs for the project stack:

```bash
rg --hidden --no-ignore -n "/Users/[A-Za-z]|BEGIN [A-Z ]*PRIVATE KEY|gh[pousr]_[A-Za-z0-9]{20,}|npm_[A-Za-z0-9]{30,}|xox[abprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{20,}" . \
  --glob '!.git/**' \
  --glob '!.omx/**' \
  --glob '!**/node_modules/**' \
  --glob '!common/temp/**' \
  --glob '!**/dist/**' \
  --glob '!**/rush-logs/**' \
  --glob '!**/.rush/**' \
  --glob '!AGENTS.md' \
  --glob '!CONTRIBUTING.md' \
  --glob '!SECURITY.md'
```
