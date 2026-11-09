---
"@rivus/agent-kit": minor
---

Show one Grok request per model call. The adapter joins the `loop_started`/`first_token` boundaries in `events.jsonl` with the `assistant` entries in `chat_history.jsonl`, so a turn that made several model calls places one request per call — each at its response start, with the model the assistant entry named — and the turn's aggregate usage (`granularity: "turn"`, with its `modelCalls` and per-model split) comes whole behind them, since Grok records usage per turn and no call is split by estimate. A session without the join files, or one past the 32 MB join budget, keeps its turn-level request, and the bounded summary pass is unchanged.
