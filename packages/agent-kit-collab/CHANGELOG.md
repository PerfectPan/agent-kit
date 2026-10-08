# Change Log - @rivus/agent-kit-collab

This log was last generated on Thu, 08 Oct 2026 04:46:15 GMT and should not be manually modified.

## 0.3.0
Thu, 08 Oct 2026 04:46:15 GMT

### Minor changes

- First release: /lease (Effect: createLeaseManager, SQLite, file and memory stores, fenced work interrupted on lease loss) and /process-lock (acquireProcessLock), released in lockstep with @rivus/agent-kit.
- Add /lanes (Effect): createLanes({ maxConcurrent, maxQueued?, turnTimeoutMs?, activate, onExit? }) runs at most one activation per key, coalesces wakes into one pending activation, caps concurrency across keys, bounds the queue (LaneQueueFull), interrupts an activation after its turn timeout, and offers wake, cancel, status and close in the caller's Scope.

### Updates

- Document lockstep package installation and application adoption.

