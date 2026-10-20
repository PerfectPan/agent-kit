# npm Release Runbook

pnpm owns change records (`pnpm change`), version bumps and changelogs (`pnpm version -r`) and publishing
(`pnpm publish -r`). Two packages are published to npm, both in the one `versioning.fixed` group of
`pnpm-workspace.yaml`: `@rivus/agent-kit` (`packages/agent-kit`) and `@rivus/agent-kit-collab`
(`packages/agent-kit-collab`). They share one version, one tag `v<version>`, one release PR and one publish run,
by GitHub Actions with npm Trusted Publishing (OIDC) and provenance. The internal packages under `packages/` are
private (`"private": true`) and ship inside the shell's `dist`; collab bundles only its own code and names
`@rivus/agent-kit` as a peer. No long-lived npm token is stored in the repository or its secrets.

This repository releases automatically: every push to `main` with pending changesets opens or updates the release
PR, and merging it tags and publishes. [PerfectPan/project-template-pnpm](https://github.com/PerfectPan/project-template-pnpm),
whose release setup this repository otherwise follows, releases by manual dispatch of Version Packages and a
hand-made GitHub Release instead.

| Step | Where | Result |
| --- | --- | --- |
| Changeset | feature PR | `.changeset/<name>.md`, written with `pnpm change` or by hand; CI does not check for it |
| Version Packages | `version-packages.yml`, on each push to `main` with pending changesets | draft PR `chore(release): version packages` on `changeset-release/main`, whose body lists each package's changelog section, opened or updated only after `pnpm run check` passes on the bumped tree |
| Release PR merge | GitHub, the only manual step | bumped `package.json` versions, `CHANGELOG.md` per package and `.changeset/ledger.yaml` on `main`, no pending changesets |
| Tag and GitHub Release | `publish-npm.yml`, on the merge push | annotated tag `vX.Y.Z` and a GitHub Release with generated notes on the release commit |
| Publish | `publish-npm.yml`, same run | packages on npm with provenance |

Each row is a separate completion state. A merged release PR is not a published release, and a started publish
workflow is not a published package.

Both workflows run on every push to `main` (a PR merge is a push) and first run `scripts/release-state.ts` in a
small job that installs pnpm but no dependencies. It reads the pending changesets, the shared version of the
`versioning.fixed` group (through `pnpm ls` and `pnpm config get versioning`) and the remote tag, and prints one
state; only the matching workflow does further work:

| State | When | Version Packages | Publish npm |
| --- | --- | --- | --- |
| `version` | `.changeset/` contains changesets (`*.md` other than a README) | opens or updates the release PR | skips |
| `publish` | no changesets, the group version is not `0.0.0`, and `v<version>` is not on the remote or is on this commit | skips | tags, creates the Release, publishes |
| `none` | otherwise, for example a docs push after a release | skips | skips |

A tag on the pushed commit itself means an earlier run of that commit pushed it and then failed, so a re-run
resumes the release. `release-state.ts` fails when there is not exactly one `versioning.fixed` group or its members
disagree on the version. Pushes to `changeset-release/main` and tags start neither workflow.

## Changesets

A PR that changes what a published package ships (source, manifest, build config, or an internal package that the
shell bundles) or the lockfile carries a changeset. CI does not check for a missing one; the author adds it and the
reviewer looks for it. Write it with:

```bash
pnpm change @rivus/agent-kit --bump patch --summary "Correct the Codex session title."
```

Name the package as an argument: without one, `pnpm change` prompts for the packages, the bump and the message and
needs a terminal, and `pnpm --filter <package> change -y` fails without one too. Name both packages when a change
affects both. The command writes `.changeset/<random-name>.md`, which you can also write by hand under any short
kebab-case name:

```markdown
---
"@rivus/agent-kit": patch
"@rivus/agent-kit-collab": patch
---

Correct the Codex session title.
```

The summary becomes the changelog entry, so write it for users of the package. Rules for the bump:

- A change inside an internal package ships in the shell's `dist`; its changeset names `@rivus/agent-kit`.
- The group releases at one shared version: the largest bump across the pending changesets applies to both
  packages, and a package without a changeset of its own gets an empty section for that version.
- While the packages are 0.x, a breaking change is `minor`. `major` would release 1.0.0.
- `pnpm change status` prints the pending changesets and the versions they would release.

## Versioning Configuration

`pnpm-workspace.yaml` sets `versioning.changelog.storage: repository`, so `pnpm version -r` deletes consumed
changesets immediately, writes each package's `CHANGELOG.md` and records what it consumed in
`.changeset/ledger.yaml`. The default (`registry`) keeps changesets until the registry confirms publication; the
release PR would then never stop reappearing, because the changesets action and `release-state.ts` decide from the
remaining `.changeset/*.md` files.

`versioning.fixed` holds one group with both published packages. A new published package joins the group, which
`scripts/check-release.ts` enforces indirectly: it requires every published package to carry the tag's version.
`release-state.ts` accepts only one group, so versioning the packages independently means choosing a tag scheme
(for example `release-2026-10-01`), teaching `release-state.ts` and `check-release.ts` when it is due, and
documenting it here.

Two packages in one group:

- Collab names `@rivus/agent-kit` as a peer with `"workspace:^"`. `pnpm publish` replaces it with `^<version>` of
  the same release, so the published pair always matches. `release:check` refuses a published package that names
  another published package without the `workspace:` protocol, and one that installs a private workspace package
  (bundle it as a devDependency instead).
- `pnpm publish -r` publishes in dependency order: `@rivus/agent-kit` first, then collab, which depends on it, so the
  peer a collab release needs is on npm before collab is. A package that fails to publish stops the run before the
  packages after it.
- The consumer smoke test in `packages/agent-kit/scripts/smoke-consumer.ts` packs every package of the group with
  pnpm, installs the tarballs together, and checks that collab resolves the consumer's copies of `@rivus/agent-kit`
  and `effect`. A new member of the group needs a row in its `COMPANIONS` table.

## One-Time Setup

### Repository

1. Keep the repository public. pnpm attaches provenance only when the repository and the package are public; from a
   private repository it publishes without provenance.
2. Every published `package.json` has `repository.url` pointing at this GitHub repository (`git+https://github.com/OWNER/REPO.git`)
   and `publishConfig.access: "public"`. npm rejects provenance when the repository does not match, and
   `pnpm run release:check` enforces both.
3. Let GitHub Actions create pull requests: **Settings → Actions → General → Workflow permissions → Allow GitHub
   Actions to create and approve pull requests**. Version Packages fails without it, on the first push to `main`
   that leaves changesets pending.

### npm Trusted Publisher, per package

A trusted publisher is configured per package name, and npm only offers the setting for a package that already
exists. For each package:

1. **First publish only.** OIDC cannot create a new package name, so a maintainer publishes a placeholder `0.0.0`
   once, with their own npm login. The real releases are higher, so the placeholder never collides with them:

   ```bash
   dir="$(mktemp -d)" && cd "$dir"
   printf '{"name":"@rivus/agent-kit","version":"0.0.0","description":"Placeholder; releases are published by CI."}\n' > package.json
   npm publish --access public
   npm deprecate @rivus/agent-kit@0.0.0 "Placeholder; install a later version."
   ```

   Scoped packages need an npm organization or user scope that the maintainer owns. Skip this step if the name
   already exists on npm.
2. On npmjs.com open the package **Settings → Trusted Publisher → GitHub Actions** and enter the owner, the
   repository, the workflow filename `publish-npm.yml`, and no environment (unless you add one to the workflow).
   The trusted publisher is bound to that file name, so renaming the workflow means configuring it again.
   Enable **direct publishing** ("Allow npm publish"): new configurations default to staged publishing only, and
   `pnpm publish` then fails with an authorization error. The CLI equivalent (npm 11.15 or later, two-factor
   authentication on the account) is:

   ```bash
   npm trust github @rivus/agent-kit --repo PerfectPan/agent-kit --file publish-npm.yml --allow-publish
   npm trust list @rivus/agent-kit
   ```

   A new configuration expires unless a publish uses it within 2 days, so create it right before merging the first
   release PR, not days ahead.
3. Under **Publishing access**, select "Require two-factor authentication and disallow tokens" so that only the
   trusted workflow can publish.

One package's trusted publisher does not authorize another. A publish for an unconfigured package fails with an
authentication error for that package; since `pnpm publish -r` stops at the first failure, the packages after it
are not published either.

#### `@rivus/agent-kit-collab`

Collab first shipped with the release after `0.2.0`. A new published package goes through the same steps before
the merge of its first release PR: publish the placeholder `0.0.0` (step 1 above, with its name) and deprecate it,
configure its trusted publisher within 2 days of the merge (step 2), and set **Publishing access** (step 3).

If the merge publishes before the new package's trusted publisher exists, the packages before it are published and
the run fails at it with an authentication error. Configure the publisher and re-run the failed run, as under
[Failure Recovery](#failure-recovery); the tag and Release stay, and pnpm publishes only what is missing.

## Cutting a Release

1. Merge feature PRs with changesets (see [Changesets](#changesets)).
2. Each such merge runs Version Packages. `changesets/action` runs `pnpm run release:version`: `pnpm version -r`
   consumes the changesets, bumps both packages to the new shared version and writes their changelogs, then
   `pnpm run check` runs on the bumped tree. Only when both pass does the action commit the result through the
   GitHub API (signed) and open or update the draft PR `chore(release): version packages` from
   `changeset-release/main`; the PR body lists each package's new `CHANGELOG.md` section. Every later push with
   changesets regenerates the PR from the new `main`, and a re-run on a `main` that has moved on leaves the PR to the
   newer run. **Actions → Version Packages → Run workflow** on `main` regenerates it on demand, for example after the
   PR was closed by hand. The bump comes only from the changesets: to release a different bump, merge a changeset
   with that bump.
3. Review the version and changelog diff, then select **Ready for review**. Pull requests created with the
   workflow's `github.token` do not trigger workflows, and the `ready_for_review` event starts CI (closing and
   reopening the PR also works). Wait for green checks and squash-merge. To skip the extra click, pass a GitHub App
   token or a fine-grained PAT to the action's `github-token` input, never through the `GITHUB_TOKEN` environment
   variable, which the action rejects when it differs from the input.
4. The merge push runs Publish npm on the merge commit. After waiting for any other run of the same version, it
   checks the state again, creates the annotated tag `vX.Y.Z` locally, and runs `release:check --verify-git`: the
   tag equals the version of every published package, no changesets remain and the commit is on `origin/main`. It
   then runs `pnpm install --frozen-lockfile` and `pnpm run check`, pushes the tag, creates a GitHub Release with
   generated notes, and runs `pnpm publish -r --access public --no-git-checks`. pnpm skips private packages and
   versions that already exist on npm. The remote refuses to move an existing tag, so two runs cannot release one
   version from different commits.
5. Verify every package at the new version, for example `npm view @rivus/agent-kit@X.Y.Z`,
   `npm view @rivus/agent-kit-collab@X.Y.Z` and a clean `npm install @rivus/agent-kit @rivus/agent-kit-collab` in a
   scratch project. Registry reads can lag the publish by a minute; retry the read, not the
   publish. The npm package page shows a provenance badge linking to the workflow run.

`pnpm run publish:dry-run` runs the same `pnpm publish -r` command with `--dry-run --json`: it does everything a
publish would do except uploading, and prints, per package a publish would upload, the version and the file list.
Run it after `pnpm run check` so `dist` exists.

## Bot Pull Requests

- **Release PR**: see step 3 above. Its title already passes `gh repo-checks pr-title`; bot PRs skip the description check.
- **Dependabot npm PRs**: one weekly PR carries every minor and patch npm update, and a second one every major.
  Dependabot officially supports pnpm 7–10; on pnpm 12 its support is limited (dependabot-core#16397), so a PR may
  edit `package.json` files or the catalog in `pnpm-workspace.yaml` without regenerating the root `pnpm-lock.yaml`.
  Check out the branch, run `pnpm install`, commit the lockfile, and push. A `vite-plus` bump and the matching
  `vite` alias (`npm:@voidzero-dev/vite-plus-core`) land in separate PRs; add the alias bump to the first branch
  before merging so the two stay in lockstep. Then add changesets:
  - For each published package whose runtime dependencies changed:
    `pnpm change <name> --bump patch --summary "Update dependencies."`.
  - When the PR moves the exact optional `effect` peer (Dependabot moves it together with the devDependency), one
    `minor` changeset naming both `@rivus/agent-kit` and `@rivus/agent-kit-collab`, whose summary names the new
    version and says that hosts pinning the old one fail to install under npm. Update the version written in
    `README.md`, both package READMEs, `docs/development/adoption.md` and `docs/specs/0001-agent-kit.md`
    (`git grep` the old version outside the `CHANGELOG` files).
- **Dependabot GitHub Actions PRs** move an action to its next major version tag (for example `actions/checkout@v7`
  to `@v8`); minor and patch releases need no PR because workflows reference the major tag. Merge them for this
  repository's own workflows (`ci.yml`, `version-packages.yml`, `publish-npm.yml`). Close PRs that touch `review.yml` or another file
  synced from [PerfectPan/project-template](https://github.com/PerfectPan/project-template), with a comment that the
  bump comes from upstream, and sync the file once upstream has it. Dependabot cannot ignore an action per file, so
  these PRs keep appearing.

## Failure Recovery

- **Version Packages fails**: nothing is released, and the release PR stays as it was, because the action pushes
  only after `pnpm version -r` and `pnpm run check` pass; the run is red. Re-run it for a transient failure.
  Otherwise fix the cause in a new PR with or without a changeset, and its merge regenerates the release PR.
- **Validation fails before publishing** (`release:check`, `pnpm run check` in Publish npm): nothing was tagged or
  published. Re-run the run for a transient failure. Otherwise fix the cause in a new PR: a fix without changesets
  releases the same version from its merge commit, and a fix with changesets goes into the next release PR,
  leaving the unpublished version out.
- **Tag pushed, nothing published, and a re-run cannot fix it**: delete the GitHub Release and the tag
  (`gh release delete vX.Y.Z --cleanup-tag`) and merge the fix; the next push without changesets releases the
  version from its commit. This and the previous case are the only ones where a version's tag may move.
- **Authentication fails for a package**: configure its trusted publisher, then re-run the run (all jobs or only the
  failed ones). The tag is on the run's commit, so the re-run keeps the tag and Release, and pnpm publishes only what
  is missing at that version.
- **Partial publish**: multi-package publishing is not atomic. Re-run the run; never hand-publish a different
  artifact under the same version.
- **Manual re-publish**: GitHub re-runs a run only within 30 days. After that, publishing a non-prerelease GitHub
  Release for the existing tag starts Publish npm on the `release` event, which checks out the tag and runs the
  same checks and `pnpm publish -r`. When the Release already exists, delete only the Release (`gh release delete
  vX.Y.Z`) and create it again with `gh release create vX.Y.Z --verify-tag --generate-notes`. Do not create
  Releases for new versions by hand; the merge push tags them.
- **Bad published contents**: npm versions are immutable. Deprecate the version and release a fix:

  ```bash
  npm deprecate @rivus/agent-kit@X.Y.Z "Broken build; use X.Y.Z+1"
  ```

  Move a dist-tag back when `latest` must point at the previous version:
  `npm dist-tag add @rivus/agent-kit@<previous> latest`. `npm unpublish` is limited to 72 hours after publishing
  and blocks the version number permanently; prefer deprecation.
- Once any package of a version is on npm, do not move or reuse its tag. Fix forward with a new version.

## CI Trigger Options

`ci.yml` runs on ordinary `pull_request` and `push` events, which is enough for a single-maintainer repository. A
repository that wants CI to validate an exact head/base pair, or to skip CI on drafts, can replace it with a
`workflow_dispatch` workflow that takes `head_sha`/`base_sha` inputs and re-checks the PR head before and after the
run. That design costs a manual trigger per PR; adopt it only when stale or racing CI results are a real problem.
