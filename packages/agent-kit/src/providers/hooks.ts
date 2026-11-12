import { codexHookDialect } from "@rivus/agent-kit-provider-codex/hooks";
import { claudeCodeHookDialect } from "@rivus/agent-kit-provider-claude-code/hooks";
import { grokHookDialect } from "@rivus/agent-kit-provider-grok/hooks";
import { opencodeHookDialect } from "@rivus/agent-kit-provider-opencode/hooks";
import { geminiCliHookDialect } from "@rivus/agent-kit-provider-gemini-cli/hooks";
import { cursorHookDialect } from "@rivus/agent-kit-provider-cursor/hooks";
import { piHookDialect } from "@rivus/agent-kit-provider-pi/hooks";
import { zcodeHookDialect } from "@rivus/agent-kit-provider-zcode/hooks";
import { kimiHookDialect } from "@rivus/agent-kit-provider-kimi/hooks";
import { qoderHookDialect } from "@rivus/agent-kit-provider-qoder/hooks";
import { dimHookDialect } from "@rivus/agent-kit-provider-dim/hooks";
import { mergeService } from "./merge.js";
import type { Provider } from "./types.js";

export const builtinHookDialects: {
  readonly codex: typeof codexHookDialect;
  readonly "claude-code": typeof claudeCodeHookDialect;
  readonly grok: typeof grokHookDialect;
  readonly opencode: typeof opencodeHookDialect;
  readonly "gemini-cli": typeof geminiCliHookDialect;
  readonly cursor: typeof cursorHookDialect;
  readonly pi: typeof piHookDialect;
  readonly zcode: typeof zcodeHookDialect;
  readonly kimi: typeof kimiHookDialect;
  readonly qoder: typeof qoderHookDialect;
  readonly dim: typeof dimHookDialect;
} = {
  "claude-code": claudeCodeHookDialect,
  codex: codexHookDialect,
  cursor: cursorHookDialect,
  "gemini-cli": geminiCliHookDialect,
  grok: grokHookDialect,
  opencode: opencodeHookDialect,
  pi: piHookDialect,
  zcode: zcodeHookDialect,
  kimi: kimiHookDialect,
  qoder: qoderHookDialect,
  dim: dimHookDialect
};

// sniffSource returns the first dialect, in this order, whose payload marker a payload carries. ZCode's payloads also
// carry Grok's `hookEventName`, so ZCode comes first; Grok then precedes Cursor.
const { zcode, grok, ...otherHooks } = builtinHookDialects;
const builtins = { zcode, grok, ...otherHooks };

export const hooksTable = (providers?: readonly Provider[]): ReturnType<typeof mergeService<"hooks">> =>
  mergeService("hooks", builtins, providers);
