# npm Release Runbook

Rush owns change records, version bumps, changelogs and publishing. `@rivus/agent-kit` (`packages/agent-kit`) is the
only package in the `main` version policy and the only one published to npm, by GitHub Actions with npm Trusted
Publishing (OIDC) and provenance. The internal packages under `packages/` are private (`"shouldPublish": false`)
and ship inside its `dist`. No long-lived npm token is stored in the repository or its secrets.

| Step | Where | Result |
| --- | --- | --- |
| Change file | feature PR | `common/changes/<package>/*.json`, verified by CI |
| Version Packages | `version-packages.yml`, on each push to `main` with pending change files | draft PR `chore(release): version packages` on `rush-release/main`, verified with `npm run check` |
| Release PR merge | GitHub, the only manual step | bumped `package.json` versions, `CHANGELOG.md`/`CHANGELOG.json`, updated lockfile on `main` |
| Tag and GitHub Release | `publish-npm.yml`, on the merge push | annotated tag `vX.Y.Z` and a GitHub Release with generated notes on the release commit |
| Publish | `publish-npm.yml`, same run | packages on npm with provenance |

Each row is a separate completion state. A merged release PR is not a published release, and a started publish
workflow is not a published package.

Both workflows run on every push to `main` (a PR merge is a push) and first run `scripts/release-state.ts` in a
small job without installing dependencies. It reads the pending change files, the policy version and the remote
tag, and prints one state; only the matching workflow does further work:

| State | When | Version Packages | Publish npm |
| --- | --- | --- | --- |
| `version` | `common/changes/` contains change files | opens or updates the release PR | skips |
| `publish` | no change files, the policy version is not `0.0.0`, and `v<version>` is not on the remote or is on this commit | skips | tags, creates the Release, publishes |
| `none` | otherwise, for example a docs push after a release | skips | skips |

A tag on the pushed commit itself means an earlier run of that commit pushed it and then failed, so a re-run
resumes the release. Pushes to `rush-release/main` and tags start neither workflow.

## Version Policy

`common/config/rush/version-policies.json` defines one `lockStepVersion` policy named `main`, starting at `0.0.0`
with `nextBump: "minor"`, so the first release PR releases `0.1.0`. Every package in the policy shares one version
and is released together. A lockstep bump comes from `nextBump`, not from the bump types in change files. Pushes
use it (`minor`, right for new agents, event types or capabilities); for a release that only corrects agent facts or
fixes bugs, run Version Packages manually with `patch` (see [Cutting a Release](#cutting-a-release)).

Rush asks for change files only for published projects, so a change inside an internal package would not prompt one.
`scripts/release-intent.ts check`, which CI runs on every PR, requires a change file for `@rivus/agent-kit` whenever
a package it bundles (a private `workspace:` dependency) changes shipped files; `release-intent.ts add` writes it.

To version packages independently, switch the policy to `individualVersion`:

```json
[{ "policyName": "main", "definitionName": "individualVersion" }]
```

Rush then bumps each package from the bump types in its own change files. Update the workflows to match:
`scripts/check-release.ts` skips the tag-equals-version rule for `individualVersion`, and `scripts/release-state.ts`
accepts only a single `lockStepVersion` policy, so choose a tag scheme (for example `release-2026-10-01`), teach
`release-state.ts` when it is due, and document it here. To rename the policy, update
`version-policies.json`, every `versionPolicyName` in `rush.json`, and the `--version-policy main` arguments in
`package.json` and `.github/workflows/`.

## One-Time Setup

### Repository

1. Keep the repository public. pnpm attaches provenance only when the repository and the package are public; from a
   private repository it publishes without provenance.
2. Every published `package.json` has `repository.url` pointing at this GitHub repository (`git+https://github.com/OWNER/REPO.git`)
   and `publishConfig.access: "public"`. npm rejects provenance when the repository does not match, and
   `npm run release:check` enforces both.
3. Let GitHub Actions create pull requests: **Settings → Actions → General → Workflow permissions → Allow GitHub
   Actions to create and approve pull requests**. Version Packages fails without it, on the first push to `main`
   that leaves change files pending.

### npm Trusted Publisher, per package

A trusted publisher is configured per package name, and npm only offers the setting for a package that already
exists. For each package:

1. **First publish only.** OIDC cannot create a new package name, so a maintainer publishes a placeholder `0.0.0`
   once, with their own npm login. The policy starts at `0.0.0` and the first real release is higher, so the
   placeholder never collides with it:

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
   Enable **direct publishing** ("Allow npm publish"): new configurations default to staged publishing only, and
   `rush publish` → `pnpm publish` then fails with an authorization error. The CLI equivalent (npm 11.15 or later,
   two-factor authentication on the account) is:

   ```bash
   npm trust github @rivus/agent-kit --repo PerfectPan/agent-kit --file publish-npm.yml --allow-publish
   npm trust list @rivus/agent-kit
   ```

   A new configuration expires unless a publish uses it within 2 days, so create it right before merging the first
   release PR, not days ahead.
3. Under **Publishing access**, select "Require two-factor authentication and disallow tokens" so that only the
   trusted workflow can publish.

One package's trusted publisher does not authorize another. A publish for an unconfigured package fails with an
authentication error for that package only.

## Cutting a Release

1. Merge feature PRs with change files (`npm run change`). CI runs `rush change --verify` and
   `scripts/release-intent.ts check` on every PR except the release PR and Dependabot PRs.
2. Each such merge runs Version Packages: `rush version --bump` with the policy's `nextBump`, which consumes the
   change files, bumps the policy and package versions and writes changelogs, then `rush update` and
   `npm run check`, then opens or updates the signed draft PR `chore(release): version packages` from
   `rush-release/main`. Every later push with change files regenerates the PR from the new `main`.
3. For a bump other than `nextBump`, run **Actions → Version Packages → Run workflow** on `main` with
   `patch`/`minor`/`major` after the last feature merge of the release. The next push with change files regenerates
   the PR with `nextBump` again.
4. Review the version and changelog diff, then select **Ready for review**. Pull requests created with the
   workflow's `GITHUB_TOKEN` do not trigger workflows, and the `ready_for_review` event starts CI (closing and
   reopening the PR also works). Wait for green checks and squash-merge. To skip the extra click, give
   `create-pull-request` a GitHub App token or a fine-grained PAT instead of `GITHUB_TOKEN`.
5. The merge push runs Publish npm on the merge commit. After waiting for any other run of the same version, it
   checks the state again, creates the annotated tag `vX.Y.Z` locally, and runs `release:check --verify-git`: the
   tag equals `v<policy version>`, every package version matches, no change files remain and the commit is on
   `origin/main`. It then runs `rush install` and `npm run check`, pushes the tag, creates a GitHub Release with
   generated notes, and runs `rush publish --include-all --version-policy main --publish --set-access-level public`.
   Rush skips versions that already exist on npm. The remote refuses to move an existing tag, so two runs cannot
   release one version from different commits.
6. Verify every package at the new version, for example `npm view @rivus/agent-kit@X.Y.Z` and a clean
   `npm install` in a scratch project. Registry reads can lag the publish by a minute; retry the read, not the
   publish. The npm package page shows a provenance badge linking to the workflow run.

`npm run publish:dry-run` runs the same `rush publish` command without `--publish`: it lists what would be published
and changes nothing.

## Bot Pull Requests

- **Release PR**: see step 4 above. Its title already passes `gh repo-checks pr-title`; bot PRs skip the description check.
- **Dependabot npm PRs** edit `package.json` files but not the Rush lockfile, so `rush install` fails in CI. Check
  out the branch, run `node common/scripts/install-run-rush.js update`, commit the lockfile, add a change file
  (`node scripts/release-intent.ts add --type patch --message "Update dependencies."`) when the update affects a
  published package's runtime dependencies, and push. `ensureConsistentVersions` fails if the PR bumped a tool in
  only some packages; bump the rest in the same branch.
- **Dependabot GitHub Actions PRs** move an action to its next major version tag (for example `actions/checkout@v7`
  to `@v8`); minor and patch releases need no PR because workflows reference the major tag. Merge them for this
  repository's own workflows (`ci.yml`, `version-packages.yml`, `publish-npm.yml`). Close PRs that touch `review.yml` or another file
  synced from [PerfectPan/project-template](https://github.com/PerfectPan/project-template), with a comment that the
  bump comes from upstream, and sync the file once upstream has it. Dependabot cannot ignore an action per file, so
  these PRs keep appearing.

## Failure Recovery

- **Validation fails before publishing** (`release:check`, `npm run check` in Publish npm): nothing was tagged or
  published. Re-run the run for a transient failure. Otherwise fix the cause in a new PR: a fix without change files
  releases the same version from its merge commit, and a fix with change files goes into the next release PR,
  leaving the unpublished version out.
- **Tag pushed, nothing published, and a re-run cannot fix it**: delete the GitHub Release and the tag
  (`gh release delete vX.Y.Z --cleanup-tag`) and merge the fix; the next push without change files releases the
  version from its commit. This and the previous case are the only ones where a version's tag may move.
- **Authentication fails for a package**: configure its trusted publisher, then re-run the run (all jobs or only the
  failed ones). The tag is on the run's commit, so the re-run keeps the tag and Release, and Rush publishes only what
  is missing at that version.
- **Partial publish**: multi-package publishing is not atomic. Re-run the run; never hand-publish a different
  artifact under the same version.
- **Manual re-publish**: GitHub re-runs a run only within 30 days. After that, publishing a non-prerelease GitHub
  Release for the existing tag starts Publish npm on the `release` event, which checks out the tag and runs the
  same checks and `rush publish`. When the Release already exists, delete only the Release (`gh release delete
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
