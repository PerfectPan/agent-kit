import { resolveHome } from "@rivus/agent-kit-catalog";

import { type BundleRef, type InstallContext, ownerSlug } from "../../domain/bundle/index.js";

// https://github.com/xai-org/grok-build/blob/2bdd1d6/crates/codegen/xai-grok-pager/docs/user-guide/10-hooks.md: every
// `~/.grok/hooks/*.json` loads, always trusted, in Claude Code's format with timeouts in seconds. Grok also runs the
// hooks of `~/.claude/settings.json` and `~/.cursor/hooks.json` (see its HookDialect), but not those of Claude Code's
// skills-dir plugins.

/** Grok's home: `GROK_HOME`, or `~/.grok`. */
export function grokHome(context: InstallContext): string {
  return resolveHome("grok", context).path;
}

export function grokHooksFile(context: InstallContext, bundle: BundleRef): string {
  return `${grokHome(context)}/hooks/${ownerSlug(bundle.owner)}.json`;
}
