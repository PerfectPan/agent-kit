import { codexSessionAdapter } from "@rivus/agent-kit-provider-codex/sessions";
import { claudeCodeSessionAdapter } from "@rivus/agent-kit-provider-claude-code/sessions";
import { grokSessionAdapter } from "@rivus/agent-kit-provider-grok/sessions";
import { mergeService } from "./merge.js";
import type { Provider } from "./types.js";

export const builtinSessionAdapters: {
  readonly codex: typeof codexSessionAdapter;
  readonly "claude-code": typeof claudeCodeSessionAdapter;
  readonly grok: typeof grokSessionAdapter;
} = {
  "claude-code": claudeCodeSessionAdapter,
  codex: codexSessionAdapter,
  grok: grokSessionAdapter
};

export {
  GROK_CAPABILITIES,
  translateGrokRecords,
  type GrokTranslateOptions
} from "@rivus/agent-kit-provider-grok/sessions";

export const sessionsTable = (providers?: readonly Provider[]): ReturnType<typeof mergeService<"sessions">> =>
  mergeService("sessions", builtinSessionAdapters, providers);

export {
  CLAUDE_CODE_CAPABILITIES,
  translateClaudeCodeRecords,
  type ClaudeCodeTranslateOptions
} from "@rivus/agent-kit-provider-claude-code/sessions";

export {
  CODEX_CAPABILITIES,
  translateCodexRecords,
  type CodexTranslateOptions
} from "@rivus/agent-kit-provider-codex/sessions";
