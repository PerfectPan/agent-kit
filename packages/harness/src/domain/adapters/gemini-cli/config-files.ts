import { resolveHome } from "@rivus/agent-kit-catalog";

import { type BundleRef, type InstallContext, ownerSlug } from "../../bundle/index.js";

// https://github.com/google-gemini/gemini-cli/blob/main/docs/extensions/reference.md (every directory under
// `~/.gemini/extensions` loads and is enabled unless `extension-enablement.json` says otherwise; `gemini-extension.json`
// needs `name` and `version`) and docs/hooks/reference.md (extension hooks in `hooks/hooks.json`, milliseconds),
// checked against packages/cli/src/config/extension-manager.ts at 249d51c.

/** Gemini CLI's home: `$GEMINI_CLI_HOME/.gemini`, or `~/.gemini`. */
export function geminiHome(context: InstallContext): string {
  return resolveHome("gemini-cli", context).path;
}

export function geminiSettingsFile(context: InstallContext): string {
  return `${geminiHome(context)}/settings.json`;
}

export function geminiExtensionDir(context: InstallContext, bundle: BundleRef): string {
  return `${geminiHome(context)}/extensions/${ownerSlug(bundle.owner)}`;
}
