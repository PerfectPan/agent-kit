# npm Release Runbook

Rush owns change records, version bumps, changelogs and publishing. Packages under `packages/` that join the `main`
version policy are published to npm by GitHub Actions with npm Trusted Publishing (OIDC) and provenance. No
long-lived npm token is stored in the repository or its secrets.

| Step | Where | Result |
| --- | --- | --- |
| Change file | feature PR | `common/changes/<package>/*.json`, verified by CI |
| Version Packages | `version-packages.yml` (manual) | draft PR `chore(release): version packages` on `rush-release/main` |
| Release PR merge | GitHub | bumped `package.json` versions, `CHANGELOG.md`/`CHANGELOG.json`, updated lockfile on `main` |
| GitHub Release | GitHub UI or `gh release create` | tag `vX.Y.Z` on the release commit |
| Publish | `publish-npm.yml` (on Release `published`) | packages on npm with provenance |

Each row is a separate completion state. A merged release PR is not a published release, and a started publish
workflow is not a published package.

## Version Policy

`common/config/rush/version-policies.json` defines one `lockStepVersion` policy named `main`, starting at `0.0.0`
with `nextBump: "patch"`. Every package in the policy shares one version and is released together. A lockstep bump
comes from `nextBump`, not from the bump types in change files; pick `minor` or `major` in the Version Packages
workflow input when a release needs it. The first release of a new repository usually uses `minor` (`0.1.0`).

To version packages independently, switch the policy to `individualVersion`:

```json
[{ "policyName": "main", "definitionName": "individualVersion" }]
```

Rush then bumps each package from the bump types in its own change files. Update the workflows to match: `scripts/check-release.ts` skips the tag-equals-version rule for `individualVersion`, so choose
a tag scheme (for example `release-2026-10-01`) and document it here. To rename the policy, update
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
   Actions to create and approve pull requests**. Version Packages fails without it.

### npm Trusted Publisher, per package

A trusted publisher is configured per package name, and npm only offers the setting for a package that already
exists. For each package:

1. **First publish only.** OIDC cannot create a new package name, so a maintainer publishes a placeholder `0.0.0`
   once, with their own npm login. The policy starts at `0.0.0` and the first real release is higher, so the
   placeholder never collides with it:

   ```bash
   dir="$(mktemp -d)" && cd "$dir"
   printf '{"name":"@scope/example","version":"0.0.0","description":"Placeholder; releases are published by CI."}\n' > package.json
   npm publish --access public
   npm deprecate @scope/example@0.0.0 "Placeholder; install a later version."
   ```

   Scoped packages need an npm organization or user scope that the maintainer owns. Skip this step if the name
   already exists on npm.
2. On npmjs.com open the package **Settings → Trusted Publisher → GitHub Actions** and enter the owner, the
   repository, the workflow filename `publish-npm.yml`, and no environment (unless you add one to the workflow).
3. Under **Publishing access**, select "Require two-factor authentication and disallow tokens" so that only the
   trusted workflow can publish.

One package's trusted publisher does not authorize another. A publish for an unconfigured package fails with an
authentication error for that package only.

## Cutting a Release

1. Merge feature PRs with change files (`npm run change`). CI runs `rush change --verify` and
   `scripts/release-intent.ts check` on every PR except the release PR and Dependabot PRs.
2. Run **Actions → Version Packages → Run workflow** on `main`. Choose `policy` for the policy's `nextBump`, or
   `patch`/`minor`/`major`. The workflow runs `rush version --bump`, which consumes the change files, bumps the
   policy and package versions and writes changelogs, then `rush update`, and opens or updates the signed draft PR
   `chore(release): version packages` from `rush-release/main`.
3. Start CI on the release PR. Pull requests created with the workflow's `GITHUB_TOKEN` do not trigger workflows.
   Select **Ready for review** (the `ready_for_review` event starts CI), or close and reopen the PR. Pushing an
   empty commit to the branch also works. To avoid the manual step, give `create-pull-request` a GitHub App token
   or a fine-grained PAT instead of `GITHUB_TOKEN`.
4. Review the version and changelog diff, wait for green checks, and squash-merge.
5. Check the release identity locally on the merged release commit:

   ```bash
   git switch main && git pull
   npm run release:check -- vX.Y.Z --repository OWNER/REPO
   ```

6. Create a non-prerelease GitHub Release with tag `vX.Y.Z` targeting the release commit (not a later `main`):

   ```bash
   gh release create vX.Y.Z --target <release-commit-sha> --generate-notes
   ```

   `publish-npm.yml` checks out the tag, verifies the tag equals `v<policy version>`, every package version matches,
   no change files remain and the commit is on `main`, runs `npm run check`, then runs
   `rush publish --include-all --version-policy main --publish --set-access-level public`. Rush skips versions that
   already exist on npm. Prereleases do not publish.
7. Verify every package at the new version, for example `npm view @scope/example@X.Y.Z` and a clean
   `npm install` in a scratch project. Registry reads can lag the publish by a minute; retry the read, not the
   publish. The npm package page shows a provenance badge linking to the workflow run.

`npm run publish:dry-run` runs the same `rush publish` command without `--publish`: it lists what would be published
and changes nothing.

## Bot Pull Requests

- **Release PR**: see step 3 above. Its title already passes `gh repo-checks pr-title`; bot PRs skip the description check.
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

- **Validation fails before publishing** (`release:check`, `npm run check`): nothing was published. Fix the cause
  in a new PR, then delete the GitHub Release and its tag and create them again on the fixed commit, or cut the
  next version. This is the only case where a tag may be recreated.
- **Authentication fails for a package**: configure its trusted publisher, then re-run the failed workflow run.
  Rush skips packages already published at that version, so a re-run only publishes what is missing.
- **Partial publish**: multi-package publishing is not atomic. Re-run the workflow; never hand-publish a different
  artifact under the same version.
- **Bad published contents**: npm versions are immutable. Deprecate the version and release a fix:

  ```bash
  npm deprecate @scope/example@X.Y.Z "Broken build; use X.Y.Z+1"
  ```

  Move a dist-tag back when `latest` must point at the previous version:
  `npm dist-tag add @scope/example@<previous> latest`. `npm unpublish` is limited to 72 hours after publishing
  and blocks the version number permanently; prefer deprecation.
- Once any package of a version is on npm, do not move or reuse its tag. Fix forward with a new version.

## CI Trigger Options

`ci.yml` runs on ordinary `pull_request` and `push` events, which is enough for a single-maintainer repository. A
repository that wants CI to validate an exact head/base pair, or to skip CI on drafts, can replace it with a
`workflow_dispatch` workflow that takes `head_sha`/`base_sha` inputs and re-checks the PR head before and after the
run. That design costs a manual trigger per PR; adopt it only when stale or racing CI results are a real problem.
