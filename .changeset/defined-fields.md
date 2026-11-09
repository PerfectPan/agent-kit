---
"@rivus/agent-kit": patch
---

The catalog kernel gains `definedFields`, which drops an object's `undefined`-valued keys and types them optional without `undefined` while the keys that cannot be undefined stay required. Conditional spreads — `...(x === undefined ? {} : { key: x })` and `...(x ? { key: x } : {})` — can become one literal through it, so a key is never silently dropped and a `""` or `0` is not lost to a truthiness test. The authoring guide names it and the checks that enforce its shape-guard rules.
