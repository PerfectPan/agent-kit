---
"@rivus/agent-kit": minor
---

`doctor` now counts bridge files: the opencode and Pi adapters declare the directories of plugins and extensions their agents load without a configuration entry, and every loaded file carrying one of the caller's markers is one registration of its owner for each event the bridge forwards. A second bridge of one owner — an older release's, or a copy under another name — is reported as a `duplicate-hook`, alongside the settings-file duplicates `doctor` already found. Install adapters can declare the same for their own agents with the new `bridgeSources`.
