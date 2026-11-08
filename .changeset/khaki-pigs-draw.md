---
"@rivus/agent-kit": minor
---

The ledger records the directories an install positively created within the installation roots (schema 2, migrated from schema 1 with provenance unknown), and an uninstall removes a claimed directory once it is empty and its last owner leaves, never a pre-existing, unknown, nonempty, symlinked or externally managed one. The ledger schema moves from 1 to 2: once this version saves a ledger, older kit versions reject it as an unsupported version, and uninstalling with this version does not restore that compatibility.
