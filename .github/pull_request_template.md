Title format: `type(scope): summary`, in English.

Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.

## Summary

<!-- What changed and why. Link the issue, Spec, or Plan when there is one. -->

-

## Validation

<!-- Commands you ran and their results; logs or screenshots for behavior claims. Name skipped checks and why. -->

- [ ] Aggregate gate (format, build, lint, typecheck, test): `npm run check`
- [ ] Repository checks: `gh repo-checks repository`
- [ ] PR title and description: `gh repo-checks pr-title "<title>"`, `gh repo-checks pr-body <body-file>`
- [ ] Change files for package changes: `npm run change:verify`
- [ ] Package or release dry-run, when publishing changes: `npm run publish:dry-run`

## Risks

<!-- Optional: compatibility, rollout, rollback, or follow-up risks. Delete this section when there are none. -->

-
