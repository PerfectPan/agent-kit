---
"@rivus/agent-kit": minor
---

Add `priceRecord(record, pricing)` to `/cost`: it prices one usage record by the rules of `summarize` and returns its parts, one per model when the record is split by model, else one for the whole record, each with its `model`, `usage`, `modelCalls` when the record counts them, and `cost` (`{ costUsd, costSource }`), absent rather than 0 when nothing prices the part. The parts' costs, added up per agent and model, equal `summarize`'s groups. `/cost` also exports the `PricedRecord`, `PricedPart` and `Cost` types.
