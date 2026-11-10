import { codexSessionAdapter } from "@rivus/agent-kit-provider-codex/sessions";
import { dshSessionAdapter } from "@rivus/agent-kit-provider-dsh/sessions";
import { opencodeSessionAdapter } from "@rivus/agent-kit-provider-opencode/sessions";
import { claudeCodeSessionAdapter } from "@rivus/agent-kit-provider-claude-code/sessions";
import { grokSessionAdapter } from "@rivus/agent-kit-provider-grok/sessions";
import { zcodeSessionAdapter } from "@rivus/agent-kit-provider-zcode/sessions";
import { piSessionAdapter } from "@rivus/agent-kit-provider-pi/sessions";
import { geminiCliSessionAdapter } from "@rivus/agent-kit-provider-gemini-cli/sessions";
import { mergeService } from "./merge.js";
import type { Provider } from "./types.js";

export const builtinSessionAdapters: {
  readonly codex: typeof codexSessionAdapter;
  readonly dsh: typeof dshSessionAdapter;
  readonly opencode: typeof opencodeSessionAdapter;
  readonly "claude-code": typeof claudeCodeSessionAdapter;
  readonly grok: typeof grokSessionAdapter;
  readonly pi: typeof piSessionAdapter;
  readonly "gemini-cli": typeof geminiCliSessionAdapter;
  readonly zcode: typeof zcodeSessionAdapter;
} = {
  "claude-code": claudeCodeSessionAdapter,
  codex: codexSessionAdapter,
  dsh: dshSessionAdapter,
  opencode: opencodeSessionAdapter,
  grok: grokSessionAdapter,
  pi: piSessionAdapter,
  "gemini-cli": geminiCliSessionAdapter,
  zcode: zcodeSessionAdapter
};

export const sessionsTable = (providers?: readonly Provider[]): ReturnType<typeof mergeService<"sessions">> =>
  mergeService("sessions", builtinSessionAdapters, providers);
