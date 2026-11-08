# ZCode provider

Private implementation of ZCode identity, discovery, hooks, installation and usage, bundled into `@rivus/agent-kit`. Each service has its
own export; there is no aggregate entry.

`facts.ts` owns agent facts and `layout.ts` shares the database path between discovery and usage. `usage.ts` reads the
SQLite database `<home>/cli/db/db.sqlite` through the injected Platform port: ZCode's desktop app ships the CLI that
writes it, so discovery probes the application path and the `zcode` command name. Stored messages already count input
with cache and output with reasoning, the convention the kit's `Usage` uses, so the decoder passes them through.
The beta build's `~/.zcode-beta` is not followed.

`hooks.ts` reads ZCode's command hooks. ZCode documents none, so the dialect follows its engine
(`Contents/Resources/glm/zcode.cjs`, 3.17.2). Declarations come from `hooks.events` in the user config
`~/.zcode/cli/config.json`, which run in every project without review; from the workspace's `zcode.json` and
`.zcode/config.json` from the git root down, which wait for a review of their digests; and from an enabled plugin's
`hooks/hooks.json` or its `plugin.json` `hooks` field in Claude Code's plugin format.

Enabled plugins' hooks need no `hooks.enabled` switch. A plugin with a nonempty hook event list also enables the
user config's events when that config omits `enabled`; explicitly setting it to `false` excludes those user events.
Setting the user config's `hooks.enabled: true` lets user hooks run without a plugin and brings workspace
declarations without their own `enabled` value into digest review, unless the source or declaration is explicitly
disabled. The user switch does not control plugin hooks. The shipped default is off because the built-in plugins'
hook files contain only `{"hooks": {}}`, so they leave that default unchanged.

`install.ts` supports only `native-plugin` hooks. It writes `.zcode-plugin/plugin.json` and `hooks/hooks.json` in
`~/.agents/agent-kit/zcode/<plugin-name>` and registers that absolute directory as one element of `plugins.dirs` in
`~/.zcode/cli/config.json`. This namespace belongs to kit, outside ZCode's plugin cache. Neither path follows
`ZCODE_STORAGE_DIR`. Names use a bounded `ownerSlug` prefix plus a stable full-owner hash, so scoped slugs and long
names with identical prefixes get separate directories and valid manifest names. The manifest version follows the
bundle version. Hook groups use `timeoutMs` rounded to an integer of at least 1 ms; omission retains the engine default.
Skills use `scan-directory` in `~/.agents/skills`.

Installation and removal preserve `hooks.enabled`, `plugins.enabled` and `enabledPlugins`; a disabled plugin stays
disabled. There is no shared-config fallback. Uninstall removes only the owner's registered path and unchanged
plugin files, keeping other owners and user entries. As described above, enabling this plugin with hooks can also
run existing user `hooks.events` that were not explicitly disabled.

`verify` checks artifact contents and the directory registration, not whether ZCode enabled the plugin. The current
install interface has no enablement probe. If hooks do not run, check `plugins.enabled` and
`enabledPlugins["<manifest-name>@inline"]` in the user config. Doctor's grouped source scans kit plugins' hook files;
it cannot express the nested `/hooks/events` source, inspect enablement, or validate `timeoutMs`. ZCode does not
default to loading other agents' hook locations, so this adapter has no `legacySources` and the dialect has no
`runsHooksOf` relation.

There is no session adapter or ACP profile yet. Tests run the discovery and usage conformance suites with synthetic
SQLite fixtures, provider rendering checks and harness installation round trips; the testing package runs hook samples.
