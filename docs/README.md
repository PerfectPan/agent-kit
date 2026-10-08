# Documentation Standards

Use `docs/` for durable project knowledge that a maintainer should be able to read without replaying pull requests or chat history. This includes current architecture, development guides, operational runbooks, and factual references.

Keep collaboration policy in `CONTRIBUTING.md`, AI-agent instructions in `AGENTS.md`, issue and review evidence requirements in templates, and automated enforcement in scripts or CI workflows.

## What Belongs Here

- `architecture/` for the current system shape: domain boundaries, module boundaries, data flow, trust boundaries, storage, integrations, deployment topology, and major tradeoffs.
- `development/` for local setup, common development tasks, debugging workflows, test strategy, fixtures, release dry-runs, and stack-specific commands.
- `reference/` for stable factual material such as APIs, CLI commands, configuration, protocols, schemas, error codes, and generated interfaces.
- `operations/` for runbooks, incident response, monitoring, backups, migrations, and rollback procedures when the project has operational responsibilities.
- `tutorials/` for guided onboarding exercises when a new contributor needs a start-to-finish learning path.

Do not create empty directories just to match this list. Add a section when the project has real documentation for that reader need.

## Index

- [`architecture/authoring.md`](architecture/authoring.md): DDD authoring conventions for context packages, aggregates, ports, and the plain TS and Effect rules.
- [`development/release.md`](development/release.md): release runbook.
- [`development/adoption.md`](development/adoption.md): public entries, application migration, verification and rollback.
- [`../CONTEXT.md`](../CONTEXT.md): glossary of the domain terms, including same-name concepts with different meanings.
- [`specs/0001-agent-kit.md`](specs/0001-agent-kit.md): behavior of the public entries.
- [`plans/0001-agent-kit.md`](plans/0001-agent-kit.md): design decisions and phased execution plan.

## Spec And Plan Boundary

- [`specs/`](specs/) declares active product behavior and acceptance contracts.
- [`plans/`](plans/) contains active technical decisions and detailed execution plans.

The Change Design Gate in [`CONTRIBUTING.md`](../CONTRIBUTING.md) decides which artifacts a change needs. After delivery, lasting constraints belong in current-state `docs/`. Git history keeps the retired Spec or Plan.

## Writing Standards

- Give every durable document one clear audience, purpose, and owner area.
- Prefer current-state language over historical narration in `docs/`; link to the delivery PR for decision history.
- Keep examples runnable when practical; otherwise label them as illustrative and explain the validation gap.
- Link to source files, commands, schemas, or dashboards when they are the real source of truth.
- Update docs in the same change as behavior, configuration, command, API, deployment, architecture, or operational changes.
- Keep private tokens, internal hostnames, personal filesystem paths, generated logs, and environment-specific secrets out of documentation.
