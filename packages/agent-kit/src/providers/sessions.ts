import { codexSessionAdapter } from "@rivus/agent-kit-provider-codex/sessions";
import { claudeCodeSessionAdapter } from "@rivus/agent-kit-provider-claude-code/sessions";
import { grokSessionAdapter } from "@rivus/agent-kit-provider-grok/sessions";
import { geminiCliSessionAdapter } from "@rivus/agent-kit-provider-gemini-cli/sessions";
import { mergeService } from "./merge.js";
import type { Provider } from "./types.js";

export const builtinSessionAdapters: {
  readonly codex: typeof codexSessionAdapter;
  readonly "claude-code": typeof claudeCodeSessionAdapter;
  readonly grok: typeof grokSessionAdapter;
  readonly "gemini-cli": typeof geminiCliSessionAdapter;
} = {
  "claude-code": claudeCodeSessionAdapter,
  codex: codexSessionAdapter,
  grok: grokSessionAdapter,
  "gemini-cli": geminiCliSessionAdapter
};

export const sessionsTable = (providers?: readonly Provider[]): ReturnType<typeof mergeService<"sessions">> =>
  mergeService("sessions", builtinSessionAdapters, providers);
