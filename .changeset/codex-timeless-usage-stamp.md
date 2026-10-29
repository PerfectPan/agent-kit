---
"@rivus/agent-kit": patch
---

A Codex usage record without a readable time no longer takes the file's mtime, so decoding a file again after it is rewritten or grows keeps every call's stamp and dedupe key. The leading run without a time holds its calls until the file's first known time stamps them, the way the transcript stamps that run, or until the file is final, which stamps them 1; the fork-replay rule reads a not-yet-known stamp exactly as the transcript's batch rule does, so an incremental decode of a time-less rollout equals one decode of the whole file and counts what the transcript counts.
