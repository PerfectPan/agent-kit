# Documentation

Placement, writing rules, and plan retirement: [`docs/AGENTS.md`](AGENTS.md).
Contribution workflow and Change Design Gate: [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Index

- [`architecture/conventions.md`](architecture/conventions.md) — provider packages, service routing, domain models, boundary rules, and verification.
- [`development/release.md`](development/release.md) — release runbook.
- [`development/adoption.md`](development/adoption.md) — public entries, application migration, verification, and rollback.
- [`../CONTEXT.md`](../CONTEXT.md) — glossary of domain terms, including same-name concepts with different meanings.
- [`plans/`](plans/) — active implementation plans; each is retired in its final delivery PR/MR.

## Repository-Specific Surfaces

- Bilingual user-facing website docs live in [`apps/website/content/docs/`](../apps/website/content/docs/); update paired translations in the same PR and verify with `pnpm run check:docs`.
