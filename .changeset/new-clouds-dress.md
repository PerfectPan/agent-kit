---
"@rivus/agent-kit": minor
---

Detect ZCode, read its usage from its sessions database, and read its command hooks: `readHookEvent` maps ZCode's `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PostToolUseFailure` and `Stop` payloads to lifecycle events, and attributes a payload carrying ZCode's `traceId` to ZCode even when the hook was registered for another agent.
