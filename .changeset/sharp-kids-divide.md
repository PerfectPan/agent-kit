---
"@rivus/agent-kit": minor
---

Read four more transcript capabilities from Pi and Qoder CLI sessions. Pi (`piSessionAdapter`) replays system messages into `prompt_snapshot` events (`systemPrompt`, `toolSchemas`): the prompt as Pi renders its content and named sections, the tool declarations a message adds or removes, and a compaction's checkpoint restarting the replay. Qoder (`qoderSessionAdapter`) reads a compaction boundary's `compactMetadata` (`compactionTokens`: the trigger, the pre and post token counts, and a preserved segment that stays in the context) and turns `hook_*` attachments into `hook` events (`hooks`), skipping the other attachments by type.
