# Plan: Pi over ACP, Kimi Code, Qoder CLI, DimCode providers

- Status: in review
- Owner: unconfirmed
- Reviewer: unconfirmed
- Last updated: 2026-11-12
- Paired Spec: [docs/specs/0004-acp-and-new-agents.md](../specs/0004-acp-and-new-agents.md)

## 1. Background

### 1.1 Current behavior

Nine built-in agents; `packages/agent-kit/src/providers/unsupported.ts:22` records `pi: { acp: "No supported ACP transport." }`. Pi itself ships no ACP server; the community adapter **`pi-acp`** (npm `pi-acp`, `svkozak/pi-acp`) spawns `pi --mode rpc --no-themes` per session and speaks ACP v1 over stdio. Verified from its source: no `_meta` on `session/new` (no system-prompt channel), env passed through verbatim, `loadSession` supported, one live session per connection, tool calls are never permission-gated, and every `session/new` runs a network `npm view`.

The three new agents all ship **native ACP servers** (verified by running them):

- `kimi acp` (Kimi Code CLI 2.6.0, npm `@moonshot-ai/kimi-code`): full core+session surface, `session/list|resume|close|delete|fork`, `set_config_option`, reverse fs/terminal/elicitation. Data root `~/.kimi-code/` (env `KIMI_CODE_HOME`); sessions at `sessions/<workDirKey>/<sessionId>/{state.json, agents/main/wire.jsonl}` plus `session_index.jsonl`. Hooks: `[[hooks]]` array in `config.toml` (fields `event`, `matcher`, `command`, `timeout` seconds 1–600 default 30), stdin payload Claude-Code-shaped snake_case with `client_type: "kimi_code_cli"`, exit 0 allow / 2 block / other fail-open. API keys live in `config.toml` `[providers.*]` — never in env — except `KIMI_MODEL_*` (temporary in-memory provider) and `api_key_env`.
- `qodercli --acp` (Qoder CLI 1.1.88, installed by `curl -fsSL https://qoder.com/install | bash` into `~/.qoder/bin`, entry `~/.local/bin/qodercli`): ACP v1 server with loadSession/session list-resume-close-delete-fork, image and embeddedContext. Home `~/.qoder` (env candidates `QODER_CONFIG_DIR`/`QODER_USER_CONFIG_DIR`, `--config-dir` flag), settings `~/.qoder/settings.json` with Claude-Code-style `permissions` and hooks (it even ships `qodercli hooks migrate` from Claude Code). Hook payload snake_case: `hook_event_name`, `session_id`, `cwd`, `transcript_path`, `tool_name`, `tool_use_id`, `tool_input`, `tool_response`, `permission_mode`, `prompt`; decisions `allow|deny|ask|defer`. PAT auth env `QODER_PERSONAL_ACCESS_TOKEN`; DashScope key env `DASHSCOPE_API_KEY` appears in the binary.
- `dim acp` (DimCode 0.5.27, npm `dimcode`): ACP v1 with session new/load/prompt/cancel/list/fork/set_mode/set_model/set_config_option/close, reverse fs/terminal/elicitation, usage notifications with `costUSD`. Data root `~/.dimcode/v2` (env `DIMCODE_HOME` names the dir itself, like `PI_CODING_AGENT_DIR`); state in `dimcode.sqlite` (+wal/shm): `sessions`, `messages(role, parts JSON, orderKey, …)`, `usage_ledger(usage JSON, cost)`, `usage_run_stats(inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, cost, pricing, startedAt, endedAt)`, `session_states`, `providers`. Hooks: `hooks.json` in the data root or project `.dimcode/hooks.json`, Claude-Code-shaped groups, exit 2 blocks, payload `hook_event_name, session_id, transcript_path, cwd, model, permission_mode, agent_id, run_id`; command-file events limited to SessionStart, SubagentStart, PreToolUse, PermissionRequest, PostToolUse, PreCompact, PostCompact, UserPromptSubmit, SubagentStop, Stop; hooks must be trusted through `dim hooks`.

### 1.2 Problem

Callers of `connectAgent`/`probeAgent`/`detectAgents` cannot reach Pi, Kimi, Qoder or Dim, and no sessions/usage/install/hook knowledge exists for the three new agents.

### 1.3 Goals

1. `connectAgent("pi")` works through `pi-acp`.
2. Three new provider packages (`kimi`, `qoder`, `dim`) with identity, discovery, hooks, install, ACP — and sessions/usage wherever record shapes are verified against files produced on this machine (a local mock model backend stands in for paid keys).
3. Zero duplicated adapter logic: reuse `homeFromRule`, `VERSION_FLAG`, `fileSources`/`decodeJsonlUsage`, `decodeSqliteMessages`/`sqliteMessageSource`, `commandHook`/`groupedHooksFile`, `discoverSessions`, conformance suites.

### 1.4 Non-goals

See the Spec.

## 2. Design decisions

### 2.1 Pi profile: community adapter, first-block system prompt

- `command: "pi-acp"`, `args: []` — the adapter owns how Pi is spawned (`pi --mode rpc --no-themes`); `PI_*` env forwards overrides such as `PI_ACP_PI_COMMAND`.
- `systemPrompt: { in: "first-block" }` — pi-acp reads no `_meta` (source-verified); the codex profile already established this fallback.
- `env: [...BASE_ENV, "PI_*", "ANTHROPIC_*", "OPENAI_*", "GEMINI_*", "GOOGLE_*", "DEEPSEEK_*", "XAI_*", "OPENROUTER_*", "GROQ_*", "MISTRAL_*", "GOOGLE_APPLICATION_CREDENTIALS"]` — pi reads provider keys from env or `~/.pi/agent/auth.json`; vendor globs avoid forwarding unrelated secrets.
- Warnings record: community adapter; no permission prompts; one live session per connection; `session/new` performs a network `npm view`; needs `pi` ≥ 0.81 on `PATH`.

### 2.2 New provider ids and homes

| id | package | binary | home | home env |
| --- | --- | --- | --- | --- |
| `kimi` | `@rivus/agent-kit-provider-kimi` | `kimi` | `~/.kimi-code` | `KIMI_CODE_HOME` (names the root) |
| `qoder` | `@rivus/agent-kit-provider-qoder` | `qodercli` | `~/.qoder` | `QODER_CONFIG_DIR` (verify which of `QODER_CONFIG_DIR`/`QODER_USER_CONFIG_DIR` relocates the user root before shipping) |
| `dim` | `@rivus/agent-kit-provider-dim` | `dim` | `~/.dimcode/v2` | `DIMCODE_HOME` (names the dir itself, like `PI_CODING_AGENT_DIR`) |

### 2.3 Hooks: one dialect each, Claude-Code-shaped payloads

All three copy `commandHook`/`groupedHooksFile` conventions; payload fields map through the same `fields` paths as claude-code. Differences:

- Kimi: `[[hooks]]` in TOML → `hookStrategies: ["shared-config"]` with **toml-entry** locators (`pointer: "/hooks"`, `memberIn: "element"`, `memberKeys: ["event", "command"]`, `member: elementMember([event, command])`, content `{event, matcher?, command, timeout?}`); timeout unit seconds default 30; fail-open output (`exitCode2: "block"`, `otherExitCodes: "proceed"`-like per its fail-open contract — exact HookOutput mapping chosen at implementation against the type). Marker field `client_type`.
- Qoder: grouped hooks in `settings.json` → json-entry locators at `hooks/<Event>` with `memberIn: "hook-group"`, exactly the claude-code shared-config path; decisions allow/deny/ask/defer; extra events `PermissionDenied`, `InstructionsLoaded`, `WorktreeCreate`, `WorktreeRemove`, `CwdChanged`, `FileChanged`.
- Dim: grouped hooks in `hooks.json` with **root-keyed** event maps → json-entry at `/<Event>` with `memberIn: "hook-group"`; trust stays with the agent's own `dim hooks` review (no kit-side review claim); restricted command-file event subset.

`hookSources` for doctor: Kimi's root-level `[[hooks]]` array and Dim's root-keyed event map do not fit the existing `HookSource` layouts (`grouped`/`flat` under a `hooks` key). Add to the harness `HookSource` an optional `pointer` and layouts `event-list` (elements of the array at `pointer`, each carrying its event in a field) and `event-map` (the object at `pointer` maps event names to groups) — one SPI field, one doctor reader extension, covered by unit tests. Qoder reuses `grouped`.

### 2.4 Sessions and usage: only what real files prove

- Dim usage: decode `usage_run_stats` (flat columns) via the sessions SPI SQLite helpers; one record per run, `granularity: "turn"`, model/provider from `modelId`/`providerId`, cost from `cost`, timestamp `endedAt || startedAt`. Dim sessions: `sessions` + `messages` tables — implement against a real SQLite file captured through the mock backend.
- Kimi sessions/usage: parse `session_index.jsonl` + `<sessionDir>/state.json` + `agents/main/wire.jsonl` — implemented after capturing a real session.
- Qoder sessions/usage: locate the session store by running real sessions against the mock backend, then implement.
- Any adapter that cannot be verified ships later; `unsupported` keeps the reason until then.

### 2.5 ACP profiles for the three new agents

- kimi: `command: "kimi"`, `args: ["acp"]`, env `[...BASE_ENV, "KIMI_*"]` (profiles are static facts, so a provider whose `api_key_env` names a variable outside `KIMI_*` is not forwarded — keys belong in `config.toml` or a `KIMI_*`-named variable; the profile warns about it), system prompt first-block (its `session/new` documents no `_meta` system-prompt key — re-verify against the live server and switch to `meta` only with evidence).
- qoder: `command: "qodercli"`, `args: ["--acp"]`, env `[...BASE_ENV, "QODER_*", "DASHSCOPE_API_KEY"]`, first-block.
- dim: `command: "dim"`, `args: ["acp"]`, env `[...BASE_ENV, "DIMCODE_*", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "DEEPSEEK_API_KEY", "MOONSHOT_API_KEY", "XAI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "AIHUBMIX_API_KEY"]` (catalog `environmentVariableName`s), first-block until a `_meta` channel is proven.
- Hook sniffing order: payloads of all three are Claude-Code-like; Kimi is distinguishable by `client_type: "kimi_code_cli"` (host marker), Dim by its `run_id`/`permission_mode` combination is NOT distinctive → give Dim a conservative `hostMarkers` (or none) and order sniffing so specific markers win; verify against the shell's `sniffSource` tests.

### 2.6 Verification without paid keys

All stored model keys on this machine proved stale/revoked during research (OpenAI key valid but out of credits; DeepSeek, GLM coding-plan, ZCode tokens fail). Stand up a tiny local OpenAI-compatible mock (`/chat/completions`, SSE streaming, fixed PONG + usage) and configure each agent through its own provider config (Kimi `KIMI_MODEL_*`, Dim `dim provider add --base-url`, Pi `models.json`, Qoder BYOK/custom provider) to drive real ACP sessions, capture real session files, and run the smoke tests. The smoke suite runs the same `AGENT_KIT_SMOKE_AGENTS` path.

## 3. Execution plan

1. Pi: `packages/providers/pi/src/acp.ts` + facts, shell `acp.ts`/`unsupported.ts`, boundaries (`PI` services + ACP spi import), provider-tables test, smoke `AGENT_KIT_SMOKE_AGENTS=pi`.
2. Harness: `HookSource` pointer + `event-list`/`event-map` layouts + doctor reader + tests.
3. Provider packages `kimi`, `qoder`, `dim` (facts → identity → discovery → hooks → install → acp; conformance tests each).
4. Shell wiring for the three ids (identity/discovery/hooks/install/usage/sessions/acp tables), `unsupported.ts`, `provider-tables.test.ts`, catalog test, README matrix.
5. Boundaries entries + provider-cases; size-limit refresh via `pnpm size:update`.
6. Mock model backend; drive each agent headless; capture session stores; implement sessions/usage adapters + fixtures from the captured files.
7. Website (`agent-identity.ts`, docs mdx en/zh, demo snippets), root README, adoption doc, changesets (`minor` for `@rivus/agent-kit`).
8. Gates: `pnpm run check`, smoke for `pi,kimi,qoder,dim`, publish-safety scan; PR with evidence.

## 4. Risks

- pi-acp is community software with unstable ACP extras; warnings cover drift, and the profile pins nothing.
- Qoder home-env candidate must be verified empirically; ship the one that actually relocates settings.
- Kimi/Dim/Qoder record shapes may change quickly (fast-moving betas); adapters gate generations leniently and `unsupported` reasons stay honest where unverified.
- Local mock backend must never be committed with real credentials; it lives outside the repo (tmp) or reads no secrets.
