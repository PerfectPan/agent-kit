# Documentation

Placement, writing rules, and plan retirement: [`docs/AGENTS.md`](AGENTS.md).
Contribution workflow and Change Design Gate: [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Index

- [`architecture/conventions.md`](architecture/conventions.md) — provider packages, service routing, domain models, boundary rules, and verification.
- [`development/release.md`](development/release.md) — release runbook.
- [`development/adoption.md`](development/adoption.md) — application migration, runtime boundaries, verification, and rollback.
- [`../CONTEXT.md`](../CONTEXT.md) — glossary of domain terms, including same-name concepts with different meanings.
- [`../packages/discovery/README.md`](../packages/discovery/README.md) — built-in discovery evidence paths and excluded installer targets.
- [`../apps/website/README.md`](../apps/website/README.md) — website architecture, styling, static checks, translations, and Pages deployment.
- [`../tests/smoke/README.md`](../tests/smoke/README.md) — manual live-agent ACP smoke tests.
- [`plans/`](plans/) — active implementation plans; each is retired in its final delivery PR/MR.

## Repository-Specific Surfaces

- Bilingual user-facing website docs live in [`apps/website/content/docs/`](../apps/website/content/docs/); update paired translations in the same PR and verify with `pnpm run check:docs`.
- Published npm package references live in [`packages/agent-kit/README.md`](../packages/agent-kit/README.md) and [`packages/agent-kit-collab/README.md`](../packages/agent-kit-collab/README.md); treat them (and each package's `package.json` `exports`) as the authoritative public entry reference.
- Domain vocabulary lives at repository root in [`CONTEXT.md`](../CONTEXT.md).
