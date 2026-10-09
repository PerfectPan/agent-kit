import { type BundleRef, type InstallContext, ownerSlug } from "../../index.js";

// https://cursor.com/docs/plugins and https://cursor.com/docs/reference/plugins: a plugin under
// `~/.cursor/plugins/local/<name>/` with `.cursor-plugin/plugin.json` (only `name` is required) is discovered after a
// reload, and its `hooks/hooks.json` lists `{ "command" }` objects per event, with timeouts in seconds. Cursor has no
// home rule in the catalog; plugins live under `~/.cursor` as documented.

export function cursorHome(context: InstallContext): string {
  return `${context.home}/.cursor`;
}

export function cursorPluginDir(context: InstallContext, bundle: BundleRef): string {
  return `${cursorHome(context)}/plugins/local/${ownerSlug(bundle.owner)}`;
}
