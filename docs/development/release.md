# npm Release Runbook

Changesets owns change records (`pnpm changeset`), version bumps and changelogs (`changeset version`) and
publishing (`changeset publish`), configured in `.changeset/config.json`. Two packages are published to npm, both
in the one `fixed` group of that config: `@rivus/agent-kit` (`packages/agent-kit`) and `@rivus/agent-kit-collab`
(`packages/agent-kit-collab`). They share one version, one release PR and one publish run, by GitHub Actions with
npm Trusted Publishing (OIDC) and provenance. Each published package gets its own tag `<name>@<version>` and its
own GitHub Release. The internal packages under `packages/` are private (`"private": true`) and ship inside the
shell's `dist`; collab bundles only its own code and names `@rivus/agent-kit` as a peer. No long-lived npm token is
stored in the repository or its secrets.

| Step | Where | Result |
| --- | --- | --- |
| Changeset | feature PR | `.changeset/<name>.md`, written with `pnpm changeset` or by hand; CI does not check for it |
| Version PR | `publish-npm.yml`, on each push to `main` with pending changesets | draft PR `chore(release): version packages` from `changeset-release/main`, whose body lists each package's new changelog section |
| Version PR merge | GitHub, the only manual step | bumped `package.json` versions and `CHANGELOG.md` per package on `main`, no pending changesets |
| Publish | `publish-npm.yml`, on the merge push | the release gates run, packages publish, and the action pushes one tag and creates one GitHub Release per published package |

Each row is a separate completion state. A merged version PR is not a published release, and a started publish
workflow is not a published package.

## The Release Workflow

`publish-npm.yml` runs on every push to `main` (a PR merge is a push) and on manual dispatch. It calls the shared
workflow `PerfectPan/gh-repo-checks/.github/workflows/npm-release.yml@v1`; its jobs, permissions and general failure
handling are described in the [shared runbook](https://github.com/PerfectPan/gh-repo-checks/blob/v1/docs/npm-release.md).
npm validates the calling file, so the trusted publishers stay bound to `publish-npm.yml`.

1. **select release mode** (read-only) runs `changesets/action/select-mode`: `version` when non-empty changesets
   are pending, `publish` when there are none and unpublished versions exist, `none` otherwise. It also runs
   `gh repo-checks release-plan` in `version` mode and `gh repo-checks first-publish` in both modes.
2. **version packages** opens or updates the draft version PR with `pnpm run version-packages`. The version commit
   goes through the GitHub API, so GitHub signs it.
3. **check and pack packages** (read-only, `publish` mode) runs the repository's complete gate,
   `pnpm run check`, which includes `scripts/check-release-plan.mjs` and its 0.x major-bump cap. It then runs the
   one input this repository sets, `audit-command: pnpm --filter '!./apps/**' audit --prod --audit-level=high`,
   which covers the workspace packages and leaves out the website apps, which are never published. Finally it packs
   the unpublished versions.
4. **publish packages** is the only job with the OIDC permission. It publishes the packed tarballs through Trusted
   Publishing and creates the tags and Releases.

The caller keeps one concurrency group with `cancel-in-progress: false`: a push waits for the running run, and
GitHub keeps only the newest waiting run, cancelling older waiting ones.

## Changesets

A PR that changes what a published package ships (source, manifest, build config, or an internal package that the
shell bundles) or the lockfile carries a changeset. CI does not check for a missing one; the author adds it and the
reviewer looks for it. Write it with:

```bash
pnpm changeset add --patch @rivus/agent-kit -m "Correct the Codex session title."
```

Interactive form: `pnpm changeset` prompts for the packages, the bump and the message, and needs a terminal. Name
both packages when a change affects both. The command writes `.changeset/<name>.md`, which you can also write by
hand under any short kebab-case name:

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
  packages. A package without a changeset of its own still gets a section for that version: `@rivus/agent-kit-collab`
  lists the `@rivus/agent-kit` release under "Updated dependencies" because it peers on it, and `@rivus/agent-kit`
  gets a section that says "No changes in this release."
- While the packages are 0.x, a breaking change is `minor`. `major` would release 1.0.0; `check-release-plan.mjs`
  rejects major bumps until a reviewed PR lifts the cap.
- `pnpm changeset status --verbose` prints the pending changesets and the versions they would release.

## Versioning Configuration

`.changeset/config.json` sets `privatePackages: { version: false, tag: false }`, so the private packages are never
versioned or tagged, and `changelog-github` writes PR links and author thanks into each package's `CHANGELOG.md`.
Keep the two published packages in the same `fixed` group to preserve their shared version. A public package
outside the group would version independently; group membership does not decide whether a package is consumed.
`check-release-plan.mjs` uses Changesets' package-skipping rules to reject records naming private or ignored
packages, including `none` entries, because those records are never consumed. Versioning the packages independently
means setting `fixed: []` and documenting that choice here.

Two packages in one group:

- Collab names `@rivus/agent-kit` as a peer with `"workspace:^"`. Publishing replaces it with `^<version>` of
  the same release, so the published pair always matches. Keep the `workspace:` protocol on every dependency
  between published packages, and keep private workspace packages out of a published package's installable
  dependency fields (bundle them as devDependencies instead); the packed-manifest checks in `check:package`
  (publint, attw) and the consumer smoke test guard this on review.
- `changeset publish` publishes in dependency order: `@rivus/agent-kit` first, then collab, which depends on it,
  so the peer a collab release needs is on npm before collab is. A package that fails to publish stops the run
  before the packages after it.
- The consumer smoke test in `packages/agent-kit/scripts/smoke-consumer.ts` packs every package of the group with
  pnpm, installs the tarballs together, and checks that collab resolves the consumer's copies of `@rivus/agent-kit`
  and `effect`. A new member of the group needs a row in its `COMPANIONS` table.

## One-Time Setup

### Repository

1. Keep the repository public. pnpm attaches provenance only when the repository and the package are public; from a
   private repository it publishes without provenance.
2. Every published `package.json` has `repository.url` pointing at this GitHub repository (`git+https://github.com/OWNER/REPO.git`)
   and `publishConfig.access: "public"`, and lists published files in `files`. npm rejects provenance when the
   repository does not match, and a scoped package without public access cannot publish.
3. Let GitHub Actions create pull requests: **Settings → Actions → General → Workflow permissions → Allow GitHub
   Actions to create and approve pull requests**. The Release workflow fails without it, on the first push to `main`
   that leaves changesets pending, and so does Update Pricing on its first price change.

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
   version PR, not days ahead.
3. Under **Publishing access**, select "Require two-factor authentication and disallow tokens" so that only the
   trusted workflow can publish.

One package's trusted publisher does not authorize another. A publish for an unconfigured package fails with an
authentication error for that package; since publishing stops at the first failure, the packages after it
are not published either.

## Cutting a Release

1. Merge feature PRs with changesets (see [Changesets](#changesets)).
2. Each such merge runs the Release workflow. With pending records, `changesets/action` runs `pnpm run
   version-packages`: `changeset version` consumes the changesets, bumps both packages to the new shared version,
   writes their changelogs (with PR links and author thanks) and deletes the consumed records. The action then
   commits the result through the GitHub API (signed) and opens or updates the draft PR `chore(release): version
   packages` from `changeset-release/main`; the PR body lists each package's new `CHANGELOG.md` section. Every later
   push with changesets regenerates the PR from the new `main`. **Actions → Release → Run workflow** on `main`
   rebuilds it on demand, for example after the PR was closed by hand. The bump comes only from the changesets: to
   release a different bump, merge a changeset with that bump.
3. A breaking release is one whose change records remove or change a public export or a documented behavior.
   In 0.x, such a change is recorded as `minor`. For these releases, follow the
   [application comparison and upgrade procedure](adoption.md#application-comparison-before-release).
   Every version update leaves the version PR in Draft (`pr-draft: always`). Review the version and changelog diff,
   then select **Ready for review** to start full PR CI. Closing and reopening a Draft PR does not bypass the Draft
   guard. Confirm that `check` actually ran and passed for the current head and merge result before squash-merging;
   a skipped check is not validation evidence. PR events created with `github.token` may create runs that require
   maintainer approval; follow any GitHub approval prompt rather than assuming no run exists.
4. The merge push runs the Release workflow on the merge commit, where no record is pending: `select-mode` chooses
   `publish`, the pack job runs the gates and the audit and packs both packages, and the publish job publishes each
   packed version in dependency order through Trusted Publishing, skipping versions that are already on npm. The action pushes one tag per
   published package (`@rivus/agent-kit@X.Y.Z`, `@rivus/agent-kit-collab@X.Y.Z`) and creates one GitHub Release per
   package with its changelog section. Merging the version PR is the release decision.
5. Verify every package at the new version, for example `npm view @rivus/agent-kit@X.Y.Z`,
   `npm view @rivus/agent-kit-collab@X.Y.Z`, `git ls-remote --tags origin`, the two GitHub Releases, and a clean
   `npm install @rivus/agent-kit @rivus/agent-kit-collab` in a scratch project. Registry reads can lag the publish
   by a minute; retry the read, not the publish. The npm package page shows a provenance badge linking to the
   workflow run.

## Bot Pull Requests

- **Version PR**: see step 3 above. Its title already passes `gh repo-checks pr-title`; bot PRs skip the description check.
- **Renovate dependency PRs**: `renovate.json` enables the npm and GitHub Actions managers. Renovate owns routine
  npm/pnpm and Actions updates. There is no Dependabot routine version-update configuration; security ownership
  remains separate as described below.
  Renovate checks on Mondays from 00:00 to 06:59 in Asia/Shanghai, waits seven days after a release, and opens at
  most five concurrent version-update PRs. Automerge is disabled; require the PR checks and review major updates
  separately before merging. The waiting period stays above the workspace's one-day `minimumReleaseAge` install
  policy, so pnpm accepts every version Renovate proposes.
  Lock file maintenance has no single release to time: pnpm picks every version, transitive ones included, under its
  own one-day policy and verifies the lockfile on install. Renovate's default `timestamp-required` behaviour marks an
  update without a release timestamp as pending, so `lockFileMaintenance` sets
  `minimumReleaseAgeBehaviour: "timestamp-optional"` to keep `renovate/stability-days` from staying pending, and
  `logLevelRemap` lowers the notice Renovate then logs so it stays off the Dependency Dashboard.
  `rangeStrategy: "bump"` updates declared ranges and regenerates the pnpm lockfile through `pnpm install`.
  `ignorePaths` excludes only `node_modules`, so the smoke-test workspace is included.

  The catch-all groups separate minor/patch updates from majors. Later rules give `size-limit` and
  `@size-limit/*` their own group, the `packages:vitePlus` preset plus `oxlint-plugin-eslint` a Vite+ toolchain
  group, `effect` and `@effect/vitest` an effect group, and the root `packageManager` pin a pnpm group.
  `@effect/vitest` requires a minimum `effect` version, so they must move together to satisfy strict peer checks;
  `@effect/tsgo` has no effect peer and stays in the catch-all group. Renovate updates both size-limit catalog
  pins together only when both releases have passed the seven-day wait in the same run. Different release dates
  can leave only one eligible, so review their exact peer requirements before merging. Keep
  `strictPeerDependencies: true`. Size budgets keep 2% (at least 256 B) of headroom, so most updates pass unchanged;
  when one exceeds a budget, compare every entry's size against main and run `pnpm size:update` on the branch.

  Node upgrades remain deliberate: `engines`, `devEngines.runtime`, `.node-version`, Node versions extracted
  from workflow inputs, and major `@types/node` updates are disabled. `@perfectpan/lint-config` stays disabled because it is a Git dependency whose upgrades
  need accompanying code fixes.

  `vitest` and the `vite` alias (`npm:@voidzero-dev/vite-plus-core`) must equal `vite-plus`'s exact dependencies.
  The `vite@*` override supplies the core alias to Vitest's `vite` peer; a different `vitest` gives `@effect/vitest`
  a second copy whose runner never starts ("Cannot read properties of undefined (reading 'config')"). Grouping
  does not guarantee alignment: members can finish their release waiting periods on different days, leaving only
  part of the toolchain eligible. `scripts/toolchain.test.ts`, part of `pnpm run check`, first checks that installed
  `vite-plus` matches the catalog (otherwise it asks for `pnpm install`), then checks its two dependencies.

  If a toolchain PR drifts, check out its branch, then:

  1. Change the `vitest` and `vite` alias catalog entries to the versions the new `vite-plus` requires
     (`npm view vite-plus@<version> dependencies`).
  2. Run `pnpm install`.
  3. Commit the catalog and lockfile changes.
  4. Push the branch.

  **Lock-file maintenance** runs on the first day of each month from 00:00 to 06:59 in Asia/Shanghai. Review the
  regenerated lockfile, confirm it retains both documents and `packageManagerDependencies`, and run
  `pnpm install --frozen-lockfile` and `pnpm run check`.

  **Security ownership is separate from routine version updates.** Keep GitHub's dependency graph and Dependabot
  alerts; removing the version-update configuration does not disable either. Do not assume that an empty alert
  list proves coverage of this repository's two-document pnpm lockfile. Renovate's existing OSV checks
  (`osvVulnerabilityAlerts: true`) are experimental and cover direct dependencies; they do not prove that the
  installed app can read GitHub Dependabot alerts. `vulnerabilityAlerts.rangeStrategy: "bump"` keeps security fixes
  on the tested `pnpm install` path, including in-range fixes. Security PRs can bypass release-age and schedule
  limits and update a toolchain member alone, so apply the same alignment checks and repair procedure.

  Before assigning security-fix PRs to Renovate, verify its installed app can read this repository's Dependabot
  alerts and inspect a real hosted run that reads those alerts and handles an actionable finding. Record the
  dependency graph, alert and security-update settings independently, including package and lockfile coverage.
  Then propose a separate, explicit security handoff with one primary PR owner and a rollback path. Leave the
  existing security settings unchanged until that handoff is approved; this routine-update migration does not
  change them.

  Renovate opens a **Dependency Dashboard** issue through `config:recommended`. Use its checkboxes to retry or
  recreate an update and request a pending PR; see the [dashboard controls](https://docs.renovatebot.com/key-concepts/dashboard/).
  To pause updates, set `"enabled": false` in `renovate.json`. In Renovate 44.x, the next run closes its open PRs
  and deletes its branches but leaves the Dependency Dashboard open. Remove the setting or set it to `true` to
  resume. Keep the config file: deleting it under the hosted app opens a new "Configure Renovate" onboarding PR
  on the next run.

  **Changeset automation**: `.github/workflows/renovate-changesets.yml` runs on `pull_request` opened,
  synchronized and reopened events affecting `pnpm-lock.yaml`, `pnpm-workspace.yaml` or a `package.json`. It accepts
  only PRs authored by `renovate[bot]` from a `renovate/` branch in this repository. It runs
  [`@scaleway/changesets-renovate@4.0.5`](https://github.com/scaleway/scaleway-lib/tree/f92a76abe38e010c9a00cfe1b26d4378778116d0/packages/changesets-renovate)
  with `EXCLUDE_DEVDEPS=true` and `SORT_CHANGESETS=true`. The tool compares the head with its parent, reads manifest
  and default pnpm catalog changes, and generates a sorted patch changeset for affected published packages. The
  workflow filters every `Updated dependency` line, from manifests or catalogs, to dependencies, optional
  dependencies and peers of non-private workspace packages; if none would remain, it preserves the original file.
  If the commit already changes `.changeset/`, the tool skips generation. The tool reads
  `.changeset/config.json`, which is also the Changesets CLI configuration; the `fixed` group and the private
  packages it declares there are the same ones the release flow versions.

  Store a fine-grained personal access token as `RENOVATE_CHANGESET_TOKEN`, limited to the repositories that use
  it, with **Contents: read and write**. The `generate` job uses only the read-only `GITHUB_TOKEN`, without persisted
  checkout credentials, and has no access to the PAT. It runs the npm tool and filter, writes a summary preview, and
  uploads generated changesets plus the generation head SHA as an artifact retained for one day. The `push` job
  uses a fresh runner and the PAT without executing npm packages or repository scripts. It downloads the artifact
  by ID outside the checkout, accepts only the SHA metadata and `.changeset/renovate-<hex>.md` files, and rejects symlinks
  and existing destination files. It skips a moved branch, otherwise commits with Git hooks disabled and pushes
  without force. The bot email is in `gitIgnoredAuthors` so Renovate can still rebase the branch. Token-authenticated
  pushes trigger CI; `GITHUB_TOKEN` pushes would not. Without the secret, `push` reports "dry run only" and exits
  successfully without committing or pushing. Checkout or push failures report token expiry/access and deleted
  or moved branches as possible causes; resolve the cause and rerun the failed job while its artifact is retained,
  or rerun all jobs after the artifact expires. A compromised `generate` job can still choose the entire changeset
  content (including bump types and package names) and recorded head SHA; its effect is limited to new changeset
  files visible in the PR diff and subject to human review before merge.

  Three cases still need a person, with reminders in Renovate PR bodies:

  - **Exact optional `effect` peer**: the tool does not inspect peer dependencies, and its devDependency is
    excluded, so it generates no changeset. Add one `minor` changeset naming both `@rivus/agent-kit` and
    `@rivus/agent-kit-collab`, whose summary names the new version and says that hosts pinning the old one fail to
    install under npm. Keep the optional peer aligned with the catalog devDependency. This changeset is the only
    required release note: current-state documentation refers to `peerDependencies.effect` (for example,
    `npm view @rivus/agent-kit peerDependencies.effect`) rather than a version number, so peer updates need no
    documentation version edits.
  - **Lock-file maintenance**: the tool does not inspect lockfile resolutions. Compare the built output with the
    PR base; if a bundled dependency such as `zod/mini` changes it, add a patch changeset for the affected published
    packages. A `packageManager`-only update also generates no changeset.
  - **Toolchain or devDependency upgrades**: automation covers published runtime dependencies only. If an upgrade
    such as vite-plus or rolldown changes the built output, add a patch changeset for the affected published packages.

- **Price snapshot PRs**: `.github/workflows/update-pricing.yml` runs every Monday, or from **Actions → Update
  Pricing → Run workflow**. It runs `scripts/update-pricing.ts`, which regenerates the LiteLLM snapshot of
  `/cost/prices` and leaves it untouched when no price it keeps has changed. The generator runs in a job with a
  read-only token; on a change, a second job with write access rebuilds the branch `chore/update-pricing` from the
  commit it ran on, with the snapshot and a patch changeset for `@rivus/agent-kit`, force-pushes it and opens or
  updates the draft PR `chore(cost): update the LiteLLM price snapshot`. Only a run on `main` does that: run on
  another branch, the workflow reports in a notice whether the snapshot changed, keeps the new file as the run's
  artifact, and pushes nothing. Pull requests
  created with the workflow's `github.token` do not trigger workflows, so select **Ready for review** to start CI, as
  for the version PR. Review the diff for models that disappeared, then squash-merge; the next release ships it. A
  failing check needs a fix on the branch: the fixture-pricing test in `packages/cost/test` when LiteLLM renamed or
  dropped a model, `pnpm size:update` when it added enough models to exceed the `/cost/prices` budget. The next run replaces commits pushed to the
  branch by hand, so merge or close the PR within the week.
- **Boundary-tool upgrades**: Renovate waits 14 days for `eslint`, `eslint-plugin-boundaries`,
  `eslint-import-resolver-typescript`, `oxc-parser` and `oxlint-plugin-eslint`. Keep `oxlint-plugin-eslint` aligned
  with the oxlint version bundled by vite-plus; `scripts/toolchain.test.ts` enforces matching versions. This rule is
  separate from the workspace's one-day `minimumReleaseAge` install policy. Read the oxlint JS-plugin changelog when
  upgrading: that interface is alpha and outside semver. Run the allowed/violating boundary fixtures,
  whole-repository lint and the manifest tests, and record CI duration.
- **Renovate GitHub Actions PRs** cover every workflow, including `review.yml` and files originally synced from
  [PerfectPan/project-template](https://github.com/PerfectPan/project-template). Minor/patch updates share a group;
  major updates remain separate per action for review. Existing major tags stay as tags (for example
  `actions/checkout@v7` to `@v8`), so moving minor/patch releases behind the same tag needs no PR. This policy does
  not introduce SHA pinning. Preserve reviewed action versions when syncing template changes.

  **Routine-update rollback:** if Renovate's Actions coverage fails, restore the
  [previous Dependabot Actions configuration](https://github.com/PerfectPan/agent-kit/blob/2b1a2f12b7d19f5d5b3295374715c177ec90cf05/.github/dependabot.yml)
  and remove `github-actions` from Renovate's `enabledManagers` in the same reviewed follow-up PR. Keep npm/pnpm
  updates enabled and preserve the independent dependency graph, alert and security-update settings. Require the
  PR checks and review before merging; no bot is authorized to merge automatically.

## Failure Recovery

The action publishes only when no record is pending; with records pending it prepares the version PR instead, even
if an earlier version is still unpublished. Recovery therefore re-runs the run of the release commit itself whenever
it can.

- **select release mode failed**: `repo-checks release-plan` names a record that would never be consumed, and
  `repo-checks first-publish` names a package without a version on npm or reports a failed registry lookup; see the
  [shared runbook](https://github.com/PerfectPan/gh-repo-checks/blob/v1/docs/npm-release.md) for both. Nothing was versioned or published.
- **Version step failed** (`changeset version`, changelog lookup): nothing changed on `main` or the release branch.
  Re-run the latest run for a transient failure; otherwise fix the cause in a reviewed PR, whose merge regenerates
  the version PR. A missing `GITHUB_TOKEN` fails this step.
- **Gates failed before publication**: nothing is tagged or published. Re-run for a transient failure. Otherwise fix
  the cause in a reviewed PR: a fix without records publishes the same version from its merge push; a fix with
  records goes into the next version PR and that unpublished version is skipped. GitHub allows re-running a run for
  30 days; after that, only **Run workflow** on `main` remains, and only while no record is pending.
- **The version PR's merge run was cancelled or failed**: re-run that run. It keeps the merge commit, where no
  record is pending, so it publishes. If a later push with records ran instead, it prepared the next version PR and
  the merged version stays unpublished until this re-run. Avoid merging PRs with records while the merge run is
  still waiting.
- **Publication stopped part-way**: re-run the failed run; `changeset publish` skips versions already on npm and
  tags the rest on the run's commit. **Run workflow** on `main` does the same only while no record is pending, and
  it tags the current `main` commit instead of the release commit. Never bump the version to retry, and never
  unpublish.
- **Published but the tag or Release is missing**: `select-mode` finds nothing to publish, so re-runs do not add them. Create them by hand on the release commit:
  `gh release create '@rivus/agent-kit@X.Y.Z' --target <release commit>` (the tag format from step 4) with the
  package's changelog section as notes.
- **Version PR closed by hand or out of date**: **Run workflow** on `main` rebuilds it from the pending records.
- **Trusted Publishing rejected one package**: fix that package's trusted publisher on npmjs.com (owner,
  repository, workflow file name, environment) and re-run. One package's authorization does not cover the others.
- **A record is never consumed**: it names a private or ignored package. Remove it or move its note to a released
  package; `repo-checks release-plan` in select release mode and `check-release-plan.mjs` in `pnpm run check` name
  it.
- **Bad published contents**: npm versions are immutable. Deprecate the version and release a fix:

  ```bash
  npm deprecate @rivus/agent-kit@X.Y.Z "Broken build; use X.Y.Z+1"
  ```

  Move a dist-tag back when `latest` must point at the previous version:
  `npm dist-tag add @rivus/agent-kit@<previous> latest`. `npm unpublish` is limited to 72 hours after publishing
  and blocks the version number permanently; prefer deprecation.
- Once any package of a version is on npm, do not move or reuse its tag. Fix forward with a new version.

## CI Triggers

`ci.yml` runs full checks for Ready PRs on `opened`, `synchronize`, `reopened` and `ready_for_review`, and retains
the existing `push` trigger on `main`. Draft PR events skip the full `check` job; lightweight `Review` checks still
run. Version PRs keep their manual Draft-to-Ready handoff. There is no manual dispatch in this CI workflow.

Verify an executed successful `check` for the current head and merge result, not a skipped Draft check or a result
for an older comparison. If only the base changed, update the branch or select Draft then Ready to request fresh
PR validation. See [Required Checks](../../CONTRIBUTING.md#required-checks) for the shared PR policy.
