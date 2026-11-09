---
"@rivus/agent-kit": minor
---

The incremental SQLite message reading moves into the sessions SPI as shared helpers — the settlement of a decode (the first pass by row id, then the pages by newest change, the final look at running messages), the `message`-table queries, the paging batches and the WAL-aware change detection — which the opencode and ZCode usage decoders both use, keeping each agent's row decoding in its provider. New exports: `createSqliteSettlement`, `decodeSqliteMessages`, `sqliteMessageSource`, `sqliteQueryFloor`, `SqliteMessageRow`, `SqliteTableRow`, `SqliteSettlement`, `SqliteSettlementState`, `SqliteMessagesRequest`, `SqliteMessageDecode`, `SQLITE_LONGEST_MESSAGE_MS`, `SQLITE_RUNNING_IDS`. The records and cursor state are unchanged.
