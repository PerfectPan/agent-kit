---
"@rivus/agent-kit": minor
---

Price a session the way its transcript is priced. A Codex `request` event carries the `pricingMultiplier` of the service tier in force (2 for priority processing), as the usage record of the same request does. `summarizeSession` takes `requestUsage: true` and then returns `requestUsage`, each request's billed fields (`SessionRequestUsage`: `model`, `usage`, `granularity`, `modelCalls`, `usageByModel`, `pricingMultiplier`) in transcript order, equal to the loaded transcript's request events; `sessionAdapterConformance` checks it for every adapter. An adapter's `summarize` returns these fields with its summary, and `addRequest` takes them instead of the two token counts.
