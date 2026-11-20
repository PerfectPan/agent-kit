---
"@rivus/agent-kit": minor
---

Add Antigravity CLI (`agy`) as a built-in provider across all seven services: identity (`ANTIGRAVITY_GEMINI_DIR` / `~/.gemini`), discovery, lifecycle hooks (`hooks.json` camelCase protojson payloads), native-plugin and skills installation (`~/.gemini/config/plugins/<owner>/`, `~/.gemini/config/skills/<name>/`), JSONL transcript sessions (`antigravity-cli/brain/<id>/.system_generated/logs/transcript[_full].jsonl`), per-step token usage decoding, and the `agy acp` launch profile.
