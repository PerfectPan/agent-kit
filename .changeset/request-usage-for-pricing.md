---
"@rivus/agent-kit": minor
---

Price a session the way its transcript is priced. A Codex `request` event carries the `pricingMultiplier` of the service tier in force (2 for priority processing), as the usage record of the same request does. `summarizeSession` takes `requestUsage: true` and then returns `requestUsage`, each request's billed fields (`SessionRequestUsage`: `model`, `usage`, `granularity`, `modelCalls`, `usageByModel`, `pricingMultiplier`) in transcript order, equal to the loaded transcript's request events; `sessionAdapterConformance` checks it for every adapter, so an adapter's own `summarize` returns these fields with its summary; `summarizeSession` leaves them out for one that does not. `priceRecord` and `costOf` take a `PriceableRecord`, the fields of a `UsageRecord` they read, so a host prices such an entry without making up a source or a timestamp.
