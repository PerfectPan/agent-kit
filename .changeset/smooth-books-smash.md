---
"@rivus/agent-kit": patch
"@rivus/agent-kit-collab": patch
---

Internal domain model; no API change.

Reject array-valued ledger entries returned by an external repository as `InvalidLedger`; the file repository already rejects them.
