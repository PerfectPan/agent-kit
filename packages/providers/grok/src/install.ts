import { GROK_HOME, GROK_HOOKS_DIR, GROK_HOOK_SUFFIX, GROK_ID } from "./facts.js";
import { homeFromRule } from "@rivus/agent-kit-catalog/spi";
import {
  type BundleRef,
  type InstallContext,
  type InstallAdapter,
  ownerSlug,
  agentsOf,
  groupedHooksFile,
  jsonText,
  sharedSkillsDir,
  sharedAgentsDir
} from "@rivus/agent-kit-harness/spi";

// https://github.com/xai-org/grok-build/blob/2bdd1d6/crates/codegen/xai-grok-pager/docs/user-guide/10-hooks.md: every
// `~/.grok/hooks/*.json` loads, always trusted, in Claude Code's format with timeouts in seconds. Grok also runs the
// hooks of `~/.claude/settings.json` and `~/.cursor/hooks.json` (see its HookDialect), but not those of Claude Code's
// skills-dir plugins.

/** Grok's home: `GROK_HOME`, or `~/.grok`. */
function grokHome(context: InstallContext): string {
  return homeFromRule(GROK_ID, GROK_HOME, context).path;
}

function grokHooksFile(context: InstallContext, bundle: Pick<BundleRef, "owner">): string {
  return `${grokHome(context)}/${GROK_HOOKS_DIR}/${ownerSlug(bundle.owner)}${GROK_HOOK_SUFFIX}`;
}

/**
 * Hooks go into a file of the owner's own in `~/.grok/hooks`, which Grok scans; its plugins would need an entry in
 * `config.toml` to be enabled. When Claude Code's or Cursor's hooks land in a file Grok runs, `placeHooks` drops
 * Grok's own registration of those events, so that each fires once.
 */
export const grokInstallAdapter: InstallAdapter = {
  specificationVersion: "harness-v1",
  agent: GROK_ID,
  hookStrategies: ["scan-directory"],
  skillStrategies: ["scan-directory"],
  roots: (context) => [grokHome(context), sharedAgentsDir(context)],
  hookFile: (_strategy, bundle) => grokHooksFile({ home: "~", env: {} }, bundle),
  renderHooks: (strategy, registrations, bundle, context) =>
    registrations.length === 0
      ? []
      : [
          {
            locator: { kind: "file", path: grokHooksFile(context, bundle) },
            content: jsonText(groupedHooksFile(registrations)),
            strategy,
            agents: agentsOf(registrations)
          }
        ],
  hookSources: (context) => [
    { path: `${grokHome(context)}/${GROK_HOOKS_DIR}/*${GROK_HOOK_SUFFIX}`, format: "json", layout: "grouped" }
  ],
  renderSkill: (strategy, skill, context) => [
    { locator: { kind: "dir", path: `${sharedSkillsDir(context)}/${skill.name}` }, content: skill.files, strategy }
  ],
  legacySources: (context, owner) => [{ kind: "file", path: grokHooksFile(context, { owner }) }]
};
