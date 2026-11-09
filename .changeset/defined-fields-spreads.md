---
"@rivus/agent-kit": patch
---

The conditional spreads with an empty-object branch — `...(x === undefined ? {} : { key: x })` and `...(x ? { key: x } : {})` — are replaced across the packages by one literal through catalog's `definedFields`, which drops the `undefined`-valued keys. Two behavior refinements come with it, both intended: a truthiness test no longer silently drops an empty string or zero (an empty session id or prompt text is now kept), and an object field the record carried explicitly as `undefined` reads back as absent. Sites whose condition was load-bearing — the ledger's absent `kept` and `directories` maps, a formatting-options flag, a TOML-removal guard — keep their condition.
