# ZCode provider

Private implementation of ZCode identity, discovery, hooks and usage, bundled into `@rivus/agent-kit`. Each service has its
own export; there is no aggregate entry.

`facts.ts` owns agent facts and `layout.ts` shares the database path between discovery and usage. `usage.ts` reads the
SQLite database `<home>/cli/db/db.sqlite` through the injected Platform port: ZCode's desktop app ships the CLI that
writes it, so discovery probes the application path and the `zcode` command name. Stored messages already count input
with cache and output with reasoning, the convention the kit's `Usage` uses, so the decoder passes them through.
The beta build's `~/.zcode-beta` is not followed.

`hooks.ts` reads ZCode's command hooks. ZCode documents none, so the dialect follows its engine
(`Contents/Resources/glm/zcode.cjs`, 3.17.2): hooks are off unless a config sets `hooks.enabled: true`. Declarations
come from `hooks.events` in the user config `~/.zcode/cli/config.json`, which run in every project without review;
from the workspace's `zcode.json` and `.zcode/config.json` from the git root down, which wait for a review of their
digests; and from an enabled plugin's `hooks/hooks.json` in Claude Code's plugin format. There is no session
adapter, installer or ACP profile. An installer would write the user config's `hooks.events`, and its
`hooks.enabled: true` would also turn on every installed plugin's hooks, so that is left for a decision. Tests run
the discovery and usage conformance suites with synthetic SQLite fixtures; the testing package runs the hook
samples.
