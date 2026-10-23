---
"@rivus/agent-kit": patch
---

A hook event registered for Claude Code is no longer attributed to Cursor when only the environment carries CURSOR_VERSION, which a parent shell can leave behind: Cursor evidence now comes from the payload's cursor_version field, per Cursor's documented base hook input.
