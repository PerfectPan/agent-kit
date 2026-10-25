---
"@rivus/agent-kit": patch
---

Add a digest of the price table's content to `litellmPricesVersion` (`<date>+<commit>+<digest>`), so the version changes whenever the snapshot's prices change and hosts can tell when stored costs need recomputing.
