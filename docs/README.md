# Documentation Standards

Use `docs/` for durable project knowledge that a maintainer or user cannot easily infer from reading the code alone. This includes current architecture and tradeoffs, user guides, factual references, development workflows, and validation boundaries.

Keep collaboration policy in `CONTRIBUTING.md`, AI-agent instructions in `AGENTS.md`, issue and review evidence requirements in templates, and automated enforcement in scripts or CI workflows.

## What Belongs Here

- `guides/` for user-facing getting-started tutorials and task-oriented how-to guides (the bilingual site docs live in [`apps/website/content/docs/`](../apps/website/content/docs/)).
- `reference/` for stable factual contracts and lookup material such as APIs, CLI commands, configuration, protocols, schemas, error codes, compatibility matrices, and SemVer boundaries.
- `architecture/` for maintainer-facing knowledge that code alone cannot express: domain and module boundaries, end-to-end data flow, ownership and trust boundaries, invariants, failure and recovery semantics, and major tradeoffs.
- `development/` for local setup, test strategy, honest validation boundaries (what is verified vs unverified), debugging workflows, release runbooks, and operational procedures when the project has them.

Do not create empty directories just to match this list. Add a section when the project has real documentation for that reader need.

## Index

- [`architecture/conventions.md`](architecture/conventions.md): provider packages, service routing, domain models, boundary rules and verification.
- [`development/release.md`](development/release.md): release runbook.
- [`development/adoption.md`](development/adoption.md): public entries, application migration, verification and rollback.
- [`../CONTEXT.md`](../CONTEXT.md): glossary of the domain terms, including same-name concepts with different meanings.

## Active Plans Boundary

- [`plans/`](plans/) contains active implementation plans only while non-trivial work is in flight.

The Change Design Gate in [`CONTRIBUTING.md`](../CONTRIBUTING.md#change-design-gate) decides when a change needs a plan. After the code lands on the default branch, move lasting non-code knowledge into `docs/` (and local `Why:` comments in code), move remaining follow-up items to issues, and delete the completed plan. Git history and the delivery PR/MR keep the full plan.

## Writing Standards

- Give every durable document one clear audience, purpose, and owner area.
- Record what source code cannot express: *why* a design or workaround was chosen, alternatives rejected, ownership and trust boundaries, external system quirks, and known validation limits.
- Do not duplicate directory trees, symbol lists, or type signatures that source code and type checks already express.
- Prefer current-state language over historical narration in `docs/`; link to the delivery PR/MR for decision history.
- Keep examples runnable when practical; otherwise label them as illustrative and explain the validation gap.
- Link to source files, commands, schemas, or dashboards when they are the real source of truth.
- Update docs in the same change as behavior, configuration, command, API, deployment, architecture, or operational changes.
- Keep private tokens, internal hostnames, personal filesystem paths, generated logs, and environment-specific secrets out of documentation.
