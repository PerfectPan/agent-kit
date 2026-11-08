---
"@rivus/agent-kit": patch
---

A `first-block` system prompt now ends in a blank line, so agents that join adjacent text blocks — dsh-acp's prompt handler appends each block's text to one string — keep the boundary between the instructions and the first user text. Agents that keep blocks apart are unaffected.
