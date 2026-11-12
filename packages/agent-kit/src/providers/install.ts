import { codexInstallAdapter } from "@rivus/agent-kit-provider-codex/install";
import { claudeCodeInstallAdapter } from "@rivus/agent-kit-provider-claude-code/install";
import { grokInstallAdapter } from "@rivus/agent-kit-provider-grok/install";
import { opencodeInstallAdapter } from "@rivus/agent-kit-provider-opencode/install";
import { geminiCliInstallAdapter } from "@rivus/agent-kit-provider-gemini-cli/install";
import { cursorInstallAdapter } from "@rivus/agent-kit-provider-cursor/install";
import { piInstallAdapter } from "@rivus/agent-kit-provider-pi/install";
import { zcodeInstallAdapter } from "@rivus/agent-kit-provider-zcode/install";
import { kimiInstallAdapter } from "@rivus/agent-kit-provider-kimi/install";
import { qoderInstallAdapter } from "@rivus/agent-kit-provider-qoder/install";
import { dimInstallAdapter } from "@rivus/agent-kit-provider-dim/install";
import { mergeService } from "./merge.js";
import type { Provider } from "./types.js";

export const builtinInstallAdapters: {
  readonly codex: typeof codexInstallAdapter;
  readonly "claude-code": typeof claudeCodeInstallAdapter;
  readonly grok: typeof grokInstallAdapter;
  readonly opencode: typeof opencodeInstallAdapter;
  readonly "gemini-cli": typeof geminiCliInstallAdapter;
  readonly cursor: typeof cursorInstallAdapter;
  readonly pi: typeof piInstallAdapter;
  readonly zcode: typeof zcodeInstallAdapter;
  readonly kimi: typeof kimiInstallAdapter;
  readonly qoder: typeof qoderInstallAdapter;
  readonly dim: typeof dimInstallAdapter;
} = {
  "claude-code": claudeCodeInstallAdapter,
  codex: codexInstallAdapter,
  cursor: cursorInstallAdapter,
  "gemini-cli": geminiCliInstallAdapter,
  grok: grokInstallAdapter,
  opencode: opencodeInstallAdapter,
  pi: piInstallAdapter,
  zcode: zcodeInstallAdapter,
  kimi: kimiInstallAdapter,
  qoder: qoderInstallAdapter,
  dim: dimInstallAdapter
};

export const installTable = (providers?: readonly Provider[]): ReturnType<typeof mergeService<"install">> =>
  mergeService("install", builtinInstallAdapters, providers);
