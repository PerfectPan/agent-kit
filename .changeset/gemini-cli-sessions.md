---
"@rivus/agent-kit": patch
---

The built-in gemini-cli provider now reads the CLI's chat recordings as sessions: `sessions` lists the chats under the home's `tmp/` project directories, translates a chat's records into the transcript's user prompts, replies, thinking, tool calls and results, compactions and notices, and prices each `gemini` message that carries `tokens` as one request. A legacy single-object `.json` chat loads when its `.jsonl` replacement does not exist, and the shell's sessions table registers the adapter, removing gemini-cli's "no supported reader" entry.
