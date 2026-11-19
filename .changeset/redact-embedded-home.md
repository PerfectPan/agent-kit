---
"@rivus/agent-kit": patch
---

`redactText` keeps the separator before a home directory that continues a longer path: `/private/tmp/x/a` with home `/tmp/x` now reads `/private/~/a` instead of `/private~/a`. The home stays hidden.
