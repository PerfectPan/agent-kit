---
"@rivus/agent-kit": patch
---

Fix ZCode SQLite session reader on databases without a `time_deleted` column (#331) and return DimCode's session directory from `dimSessionAdapter.roots()` with `lastActiveAt` tracking the latest write across `sessions`, `messages`, and `usage_ledger` (#330).
