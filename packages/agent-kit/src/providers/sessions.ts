import { codexSessionAdapter } from "@rivus/agent-kit-provider-codex/sessions";
import { dshSessionAdapter } from "@rivus/agent-kit-provider-dsh/sessions";
import { opencodeSessionAdapter } from "@rivus/agent-kit-provider-opencode/sessions";
import { claudeCodeSessionAdapter } from "@rivus/agent-kit-provider-claude-code/sessions";
import { grokSessionAdapter } from "@rivus/agent-kit-provider-grok/sessions";
import { piSessionAdapter } from "@rivus/agent-kit-provider-pi/sessions";
import { mergeService } from "./merge.js";
import type { Provider } from "./types.js";

export const builtinSessionAdapters: {
  readonly codex: typeof codexSessionAdapter;
  readonly dsh: typeof dshSessionAdapter;
  readonly opencode: typeof opencodeSessionAdapter;
  readonly "claude-code": typeof claudeCodeSessionAdapter;
  readonly grok: typeof grokSessionAdapter;
  readonly pi: typeof piSessionAdapter;
} = {
  "claude-code": claudeCodeSessionAdapter,
  codex: codexSessionAdapter,
  dsh: dshSessionAdapter,
  opencode: opencodeSessionAdapter,
  grok: grokSessionAdapter,
  pi: piSessionAdapter
};

export const sessionsTable = (providers?: readonly Provider[]): ReturnType<typeof mergeService<"sessions">> =>
  mergeService("sessions", builtinSessionAdapters, providers);
