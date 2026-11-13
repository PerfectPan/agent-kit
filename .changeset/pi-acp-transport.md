---
"@rivus/agent-kit": minor
---

Launch Pi over ACP through the community pi-acp adapter: `connectAgent("pi")` and `probeAgent("pi")` drive `pi --mode rpc` with the system prompt opening the first prompt (the adapter reads no `_meta`).

ACP profiles gain `sessions: "multi" | "single"` (default `"multi"`); pi's profile declares `"single"` because the adapter keeps one live session per connection, so `newSession` and `loadSession` refuse with `TurnActive` while another session of the connection runs a turn — its adapter would close that session without settling it. Pi's launch environment forwards every provider credential pi 0.87.1 reads from the environment, including the Bedrock AWS chain and `COPILOT_GITHUB_TOKEN`.
