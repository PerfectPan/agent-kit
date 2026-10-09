import { resolveHome } from "@rivus/agent-kit-catalog";

import { type BundleRef, type InstallContext, ownerSlug } from "../../index.js";

// https://github.com/earendil-works/pi/blob/75a9972/packages/coding-agent/docs/extensions.md: every `*.ts` file in
// `~/.pi/agent/extensions/` loads as an extension, `export default function (pi) { pi.on(...) }`, and handlers get
// `ctx.cwd` and `ctx.sessionManager.getSessionId()`.

/** Pi's agent directory: `PI_CODING_AGENT_DIR`, or `~/.pi/agent`. */
export function piHome(context: InstallContext): string {
  return resolveHome("pi", context).path;
}

export function piExtensionsDir(context: InstallContext): string {
  return `${piHome(context)}/extensions`;
}

export function piExtensionFile(context: InstallContext, bundle: BundleRef): string {
  return `${piExtensionsDir(context)}/${ownerSlug(bundle.owner)}.ts`;
}
