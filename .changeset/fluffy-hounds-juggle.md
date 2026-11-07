---
"@rivus/agent-kit": minor
---

acquireProcessLock takes removeOnRelease, which removes the lock file when the lock is released; the acquisition verifies the file it locked against a pre-open reading of device, inode and birth time, so the removal cannot break mutual exclusion. FileStat carries the file identity.
