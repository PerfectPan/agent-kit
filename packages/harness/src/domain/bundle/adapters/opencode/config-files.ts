import { type BundleRef, type InstallContext, ownerSlug } from "../../index.js";
import { configHome } from "../install-files.js";

// https://opencode.ai/docs/plugins: every `{plugin,plugins}/*.{js,ts}` file in the configuration directory loads at
// start, and every export of a plugin module must be a plugin function. Checked against packages/opencode/src/config
// at a697115.

/** opencode's configuration directory: `$XDG_CONFIG_HOME/opencode`, or `~/.config/opencode`. */
export function opencodeConfigDir(context: InstallContext): string {
  return `${configHome(context)}/opencode`;
}

export function opencodePluginsDir(context: InstallContext): string {
  return `${opencodeConfigDir(context)}/plugins`;
}

export function opencodePluginFile(context: InstallContext, bundle: BundleRef): string {
  return `${opencodePluginsDir(context)}/${ownerSlug(bundle.owner)}.js`;
}
