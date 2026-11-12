---
"@rivus/agent-kit": minor
---

Show one Grok request per model call. The adapter joins the `loop_started`/`first_token` boundaries and the completed tool call ids in `events.jsonl` with the `assistant` entries in `chat_history.jsonl`, so a turn that made several model calls places one request per call, before the call's first output and with the model the assistant entry named. Grok records usage per turn, so no call is split by estimate: the turn's last call carries the turn's aggregate usage (`granularity: "turn"`, with the turn's model, `modelCalls` and per-model split), and the aggregate is not counted as a request of its own. The summary pass reads the same join, so its `requests` match the loaded transcript. A session without the join files, or one past the 32 MB join budget, keeps its turn-level request. Grok summaries now count `requests` per model call instead of per turn, so `SESSION_SUMMARY_VERSION` is 3 and cached summaries must be recomputed.
