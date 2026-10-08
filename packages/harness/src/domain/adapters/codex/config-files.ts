import { resolveHome } from "@rivus/agent-kit-catalog";

import { type BundleRef, type InstallContext, ownerSlug } from "../../bundle/index.js";

// https://developers.openai.com/codex/hooks (hooks in `config.toml` as `[[hooks.<Event>]]` groups with
// `[[hooks.<Event>.hooks]]` handlers, or in `hooks.json`; trust stored per hook by content hash) and
// https://developers.openai.com/plugins/build/plugins (marketplaces, `codex plugin add`). Checked against
// github.com/openai/codex at 3342ee8: plugins load only from the cache `codex plugin add` fills, which records
// `[plugins."<name>@<marketplace>"]` in `config.toml`; `codex plugin marketplace add <dir>` records
// `[marketplaces.<name>]`.

/** Codex's home: `CODEX_HOME`, or `~/.codex`. */
export function codexHome(context: InstallContext): string {
  return resolveHome("codex", context).path;
}

export function codexConfigFile(context: InstallContext): string {
  return `${codexHome(context)}/config.toml`;
}

/** Where older versions of some applications registered hooks without a plugin. */
export function codexHooksFile(context: InstallContext): string {
  return `${codexHome(context)}/hooks.json`;
}

/**
 * Where `codex plugin add <plugin>@<marketplace>` copies a plugin from a local marketplace, which is what Codex
 * loads (checked with codex-cli 0.154.0).
 */
export function codexPluginCache(context: InstallContext, plugin: string, marketplace: string): string {
  return `${codexHome(context)}/plugins/cache/${marketplace}/${plugin}`;
}

/**
 * The owner's own local marketplace: `.agents/plugins/marketplace.json` listing one plugin, the owner's, under
 * `plugins/<name>`. A marketplace of its own keeps the personal `~/.agents/plugins/marketplace.json` untouched.
 */
export function codexMarketplaceDir(context: InstallContext, bundle: BundleRef): string {
  return `${codexHome(context)}/plugins/${ownerSlug(bundle.owner)}`;
}
