# Agent support: Pi over ACP, Kimi Code, Qoder CLI, DimCode

- Status: draft
- Owner: unconfirmed
- Reviewer: unconfirmed
- Last updated: 2026-11-12

## Overview

`@rivus/agent-kit` grows from nine built-in coding agents to twelve and closes one gap:

- **Pi** gains an ACP transport through the community `pi-acp` adapter, so `connectAgent("pi", …)` / `probeAgent("pi", …)` work like the other ACP agents.
- **Kimi Code CLI** (Moonshot, `kimi`), **Qoder CLI** (Alibaba, `qodercli`) and **DimCode** (DimAgent, `dim`) become built-in providers with as many of the seven services as their public behavior supports.

## Scope

### In scope

- Pi: an `AcpProfile` (`./acp`), wired into the shell's ACP table; `unsupported` no longer lists `acp` for Pi.
- Kimi, Qoder, Dim: identity, discovery, hooks, install and ACP adapters; sessions and usage adapters for the storages whose record shapes can be verified against real files produced on this machine during development.
- Shell tables, `infra/architecture/boundaries.ts`, conformance and table tests, README/website support matrices, changesets.

### Out of scope

- Session or usage adapters for storages whose record shapes cannot be observed or verified (they stay in `unsupported` with a reason, and can land later as incremental patches).
- Driving Kimi/Qoder/Dim through anything other than their own ACP servers; no bridging of Pi's `--mode rpc` directly.
- Qoder cloud/remote sessions, Kimi web/remote-control, Dim remote/desktop features.

## Scenarios

### ACP-1 — Pi over ACP answers a prompt

Given `pi` and `pi-acp` on `PATH` with a working Pi model setup, when a caller runs `connectAgent("pi")`, starts a session with the system prompt "Answer every message with the word PONG only." and prompts `ping`, then the transcript ends with `end_turn` and contains `PONG`, and `probeAgent("pi")` reports a ready or needs-login state instead of `unavailable`.

### ACP-2 — Kimi, Qoder and Dim over ACP

Given `kimi`, `qodercli` and `dim` on `PATH` with working model credentials (or a local mock model endpoint configured through their own provider configuration), when a caller runs `connectAgent` for each id with the PONG system prompt, then each answers `PONG` and settles; `probeAgent` never reports `unavailable`.

### DISC-1 — discovery finds the agents

Given the agents are installed and on `PATH`, `detectAgents` reports each of `pi`, `kimi`, `qoder`, `dim` with a version, and reports config/auth evidence under their data roots (`~/.pi/agent`, `~/.kimi-code`, `~/.qoder`, `~/.dimcode/v2`). With `KIMI_CODE_HOME`, `QODER_CONFIG_DIR`-style overrides, or `DIMCODE_HOME` set, discovery follows the moved roots.

### HOOK-1 — hooks reach the agents

Installing a hook bundle for each new agent writes registrations the agent itself loads and runs: Kimi reads `[[hooks]]` entries from `config.toml`, Qoder reads grouped hooks from its `settings.json`, Dim reads grouped hooks from `hooks.json`. Payloads are Claude-Code-shaped (`hook_event_name`, `session_id`, `cwd`, …), exit code 2 blocks the blockable events, and the payload of each agent carries a stable marker (`client_type: "kimi_code_cli"` for Kimi) that payload sniffing can use to tell dialects apart.

### INST-1 — uninstall leaves the agent's own configuration standing

Uninstalling a bundle removes exactly the entries/artifacts the install created: the `[[hooks]]` elements, the `settings.json` hook groups, the `hooks.json` groups, and any skill directories, without touching the user's other configuration.

### SESS-1 — sessions and usage where verified

For every agent whose session storage was captured during development (expected: Pi already exists, Dim via SQLite, Kimi via `wire.jsonl`, Qoder via its session files), `listSessions` lists real sessions with titles and previews, `sessionAdapter.detect` recognizes the storage, and `scanUsage` decodes token counts with a stable usage key. Agents whose storage could not be captured remain unsupported with an explicit reason string.

## Acceptance

- `pnpm run check` passes on a clean checkout.
- `packages/agent-kit/test/provider-tables.test.ts` and the README support matrix agree with the wired tables.
- The ACP smoke tests (`AGENT_KIT_SMOKE_AGENTS=pi,kimi,qoder,dim pnpm run smoke`) pass on this machine using locally configured agents.
- Provider conformance suites run for each new provider package.
