# ZCode provider

Private implementation of ZCode identity, discovery and usage, bundled into `@rivus/agent-kit`. Each service has its
own export; there is no aggregate entry.

`facts.ts` owns agent facts and `layout.ts` shares the database path between discovery and usage. `usage.ts` reads the
SQLite database `<home>/cli/db/db.sqlite` through the injected Platform port: ZCode's desktop app ships the CLI that
writes it, so discovery probes the application path and the `zcode` command name. Stored messages already count input
with cache and output with reasoning, the convention the kit's `Usage` uses, so the decoder passes them through.
The beta build's `~/.zcode-beta` is not followed. There is no session adapter, hook dialect, installer or ACP
profile. Tests run the discovery and usage conformance suites with synthetic SQLite fixtures.
