---
"@rivus/agent-kit": minor
---

Detect ZCode, read its usage from its sessions database, and read its command hooks: `readHookEvent` maps ZCode's `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PostToolUseFailure` and `Stop` payloads to lifecycle events, and attributes a payload carrying ZCode's `traceId` to ZCode even when the hook was registered for another agent.

Install ZCode hooks as owner-specific plugins, register their absolute paths in the fixed user config, and install skills in the shared directory. Preserve existing plugin enablement and unrelated registrations; write hook timeouts as positive integer milliseconds with `timeoutMs`. Enabled plugins can also activate existing user hook events that are not explicitly disabled.

Keep JSON valid when uninstalling the last element of a single-line configuration array, preserving unrelated entries and trailing comments. Multiline arrays keep the parser's existing deletion and formatting behavior.
