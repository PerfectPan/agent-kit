import { codexSessionAdapter } from "@rivus/agent-kit-provider-codex/sessions";
import { dshSessionAdapter } from "@rivus/agent-kit-provider-dsh/sessions";
import { opencodeSessionAdapter } from "@rivus/agent-kit-provider-opencode/sessions";
import { claudeCodeSessionAdapter } from "@rivus/agent-kit-provider-claude-code/sessions";
import { grokSessionAdapter } from "@rivus/agent-kit-provider-grok/sessions";
import { zcodeSessionAdapter } from "@rivus/agent-kit-provider-zcode/sessions";
import { kimiSessionAdapter } from "@rivus/agent-kit-provider-kimi/sessions";
import { dimSessionAdapter } from "@rivus/agent-kit-provider-dim/sessions";
import { piSessionAdapter } from "@rivus/agent-kit-provider-pi/sessions";
import { geminiCliSessionAdapter } from "@rivus/agent-kit-provider-gemini-cli/sessions";
import { agySessionAdapter } from "@rivus/agent-kit-provider-agy/sessions";
import { copilotSessionAdapter } from "@rivus/agent-kit-provider-copilot/sessions";
import { qoderSessionAdapter } from "@rivus/agent-kit-provider-qoder/sessions";
import { mergeService } from "./merge.js";
import type { Provider } from "./types.js";

const builtinSessionAdapters: {
  readonly codex: typeof codexSessionAdapter;
  readonly dsh: typeof dshSessionAdapter;
  readonly opencode: typeof opencodeSessionAdapter;
  readonly "claude-code": typeof claudeCodeSessionAdapter;
  readonly grok: typeof grokSessionAdapter;
  readonly pi: typeof piSessionAdapter;
  readonly "gemini-cli": typeof geminiCliSessionAdapter;
  readonly zcode: typeof zcodeSessionAdapter;
  readonly dim: typeof dimSessionAdapter;
  readonly kimi: typeof kimiSessionAdapter;
  readonly agy: typeof agySessionAdapter;
  readonly copilot: typeof copilotSessionAdapter;
  readonly qoder: typeof qoderSessionAdapter;
} = {
  "claude-code": claudeCodeSessionAdapter,
  codex: codexSessionAdapter,
  dsh: dshSessionAdapter,
  opencode: opencodeSessionAdapter,
  grok: grokSessionAdapter,
  pi: piSessionAdapter,
  "gemini-cli": geminiCliSessionAdapter,
  zcode: zcodeSessionAdapter,
  dim: dimSessionAdapter,
  kimi: kimiSessionAdapter,
  agy: agySessionAdapter,
  copilot: copilotSessionAdapter,
  qoder: qoderSessionAdapter
};

export const sessionsTable = (providers?: readonly Provider[]): ReturnType<typeof mergeService<"sessions">> =>
  mergeService("sessions", builtinSessionAdapters, providers);
