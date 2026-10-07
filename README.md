# Project Template: Rush

A repository template for TypeScript monorepos managed with [Rush](https://rushjs.io) and pnpm that publish
packages to npm.

It layers a Rush workspace, shared lint and format rules, CI, and an npm release flow on top of the stack-agnostic
[PerfectPan/project-template](https://github.com/PerfectPan/project-template), and keeps that template's
contribution workflow (Spec + Plan), review checks, Git hooks and documentation standards.

## Stack

| Concern | Choice |
| --- | --- |
| Monorepo | Rush 5.180.0, pnpm 12.8.1 (workspaces), pinned in `rush.json` |
| Runtime | The current Node.js LTS major in `.node-version` (`24`); CI resolves its latest patch. `engines` requires `^24.11.0` |
| Language | TypeScript 7.0.2, `tsconfig` extends `@perfectpan/lint-config/tsconfig/node.json` |
| Lint and format | oxlint 1.86.0 + oxlint-tsgolint (type-aware), oxfmt 0.71.0, shared configs from [`@perfectpan/lint-config`](https://github.com/PerfectPan/lint-config) v0.3.2 |
| Tests | Vitest 5 |
| Releases | Rush change files, lockstep version policy `main`, npm Trusted Publishing with provenance |

## Quick Start

1. **Create the repository** from this template (GitHub **Use this template**, or
   `gh repo create OWNER/REPO --public --template PerfectPan/project-template-rush --clone`).
2. **Rename the placeholders.**
   - Package scope and name: `@scope/example` in `rush.json`, `packages/example/package.json`, its README, and the
     directory `common/changes/@scope/example/`. Rename or replace `packages/example` itself as needed.
   - Repository URL: `PerfectPan/project-template-rush` in `rush.json` and every published `package.json`
     `repository.url`. npm provenance requires it to match the publishing repository.
   - Root `package.json` `name` and this README. Pick the license by project type: libraries and tools keep
     the MIT `LICENSE` (update the holder); applications switch to GPL-3.0-only (see `CONTRIBUTING.md` License).
   - Optionally the version policy name `main` (see [the release runbook](docs/development/release.md#version-policy)).
3. **Install and check.**

   ```bash
   gh extension install PerfectPan/gh-repo-checks
   ./scripts/install-git-hooks.sh
   node common/scripts/install-run-rush.js update   # refreshes the lockfile after renaming
   npm run check
   ```

4. **Protect the default branch** with an admin-authorized `gh` session:

   ```bash
   gh repo-checks protect --repo OWNER/REPO --approvals 0 --check check --apply
   ```

   `--check check` requires the CI job named `check` next to the review checks. `--approvals 0` suits a single
   maintainer, who cannot approve their own pull requests; drop it to require one approving review.

   Also allow GitHub Actions to create pull requests (**Settings → Actions → General**) so Version Packages can open
   the release PR.
5. **Set up npm Trusted Publishing** for every package before the first release, following
   [docs/development/release.md](docs/development/release.md#one-time-setup).

## Layout

```text
rush.json                     Rush projects and the Rush, pnpm and Node versions
common/config/rush/           bulk commands, version policy, pnpm settings, lockfile
common/changes/               pending Rush change files, consumed by Version Packages
common/scripts/               install-run-rush.js and friends (managed by Rush; do not edit)
packages/example/             example public library: src, Vitest test, tsc build to dist
scripts/                      repo-scripts project (release-intent.ts, check-release.ts) and the template's shell checks
.github/workflows/            ci.yml, review.yml, version-packages.yml, publish-npm.yml
docs/development/release.md   release runbook
```

The root `package.json` is not a Rush project. Its scripts call `common/scripts/install-run-rush.js`, so
`npm run check` works without a global Rush or pnpm.

## Commands

| Command | What it runs |
| --- | --- |
| `npm run check` | `format:check`, `build`, `lint`, `typecheck`, `test` (repository checks run in the Review workflow and the pre-commit hook) |
| `npm run build` / `lint` / `typecheck` / `test` / `format` / `format:check` | the Rush bulk command of the same name in every project |
| `npm run change` | `rush change`: record a release note for changed packages |
| `npm run change:verify` | `rush change --verify` plus `scripts/release-intent.ts check` against `origin/main` |
| `npm run version-packages` | `rush version --bump --version-policy main`, then `rush update` |
| `npm run release:check -- vX.Y.Z --repository OWNER/REPO` | tag, version, manifest and pending-change checks before publishing |
| `npm run publish:dry-run` | `rush publish` without `--publish`: lists what would be published |

## CI and Releases

- `ci.yml` runs `npm run check` on pull requests and `main`, and on pull requests also requires Rush change files
  for package changes. It caches Rush's pnpm store and npm cache, keyed by the lockfile. Private repositories pay for
  Actions minutes: there, consider running CI only on `ready_for_review` plus `workflow_dispatch` instead of every push.
- `review.yml` (from the upstream template) checks repository hygiene, the PR title and the PR description.
- `version-packages.yml` (manual) opens the draft PR `chore(release): version packages`.
- `publish-npm.yml` publishes when a non-prerelease GitHub Release is published.
- Dependabot updates npm dependencies and GitHub Actions weekly with `chore(deps)` titles.

Workflows reference actions by their latest major version tag, such as `actions/checkout@v7`, not by commit SHA. See
[docs/development/release.md](docs/development/release.md) for the release procedure and recovery steps.

## License

MIT. See [LICENSE](LICENSE). Projects created from this template choose their own license by project type.

## Template Maintenance

Generic files come from [PerfectPan/project-template](https://github.com/PerfectPan/project-template): the policy
sections of `AGENTS.md` and `CONTRIBUTING.md`, `SECURITY.md`, `docs/README.md`, `docs/specs/`,
`docs/plans/`, the PR/MR and issue templates, `.githooks/pre-commit`, `.github/workflows/review.yml`, and the shell
scripts under `scripts/`. Sync those from upstream instead of editing them here, then keep the Rush-specific additions:

- the filled command sections in `AGENTS.md`, `CONTRIBUTING.md` and the PR/MR templates;
- `.githooks/pre-push`, the Rush entries in `.gitignore`, and everything Rush, npm or TypeScript specific.

Keep this template free of project-specific business logic; `packages/example` stays a minimal example.
