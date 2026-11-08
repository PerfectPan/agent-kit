---
"@rivus/agent-kit": minor
---

Detect DeepSeek Harness and launch it over ACP. `detectAgents` finds the `dsh` command and its version, follows `DSH_HOME` (default `~/.dsh`), and counts a stored `.credentials.yaml` or `DEEPSEEK_API_KEY` as a login without reading the file's values; `/acp` launches `dsh --profile acp`, which needs no authentication and takes the system prompt in the first prompt block.

The launch profile preserves `DSH_PERMISSION_MODE` and `DSH_BUNDLED_SKILL_DIR`, and excludes internal subprocess markers and generated speech-worker tokens. Custom pi-ai `apiKeyEnv` keys need explicit forwarding only when they are available solely in the caller’s environment.
