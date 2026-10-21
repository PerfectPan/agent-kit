import { loadTranscript as contextLoadTranscript } from "@rivus/agent-kit-sessions/public";
import { summarizeSession as contextSummarizeSession } from "@rivus/agent-kit-sessions/public";
import { sessionsTable } from "./providers/sessions.js";
import { identityTable } from "./providers/identity.js";
import type { ProviderOptions } from "./providers/types.js";

export {
  CAPABILITIES,
  CLAUDE_CODE_CAPABILITIES,
  claudeCodeUsage,
  CODEX_CAPABILITIES,
  codexUsage,
  GROK_CAPABILITIES,
  grokUsage,
  foldStreamParts,
  foldTranscript,
  isPrompt,
  laneOf,
  latestSnapshot,
  MAIN_LANE_ID,
  mainAgentId,
  promptSnapshot,
  promptStarts,
  readOriginal,
  recordKey,
  requestUsage,
  SESSION_SUMMARY_VERSION,
  sessionPrompts,
  shadowedIn,
  snapshotHasSystemPrompt,
  snapshotHasTools,
  TRANSCRIPT_EVENT_KINDS,
  translateClaudeCodeRecords,
  translateCodexRecords,
  translateGrokRecords
} from "@rivus/agent-kit-sessions/public";
export type {
  CapabilityUnsupported,
  Capability,
  ClaudeCodeTranslateOptions,
  CodexTranslateOptions,
  GrokTranslateOptions,
  CompactionPayload,
  HookPayload,
  Lane,
  LiveTranscriptEvent,
  LoadTranscriptError,
  MessagePayload,
  NoAdapterAccepted,
  ParsedTranscript,
  PromptSnapshotPayload,
  ReadFailed,
  ReadOriginalError,
  ReasoningPayload,
  RequestPayload,
  SessionNotFound,
  SessionPromptsOptions,
  SessionPrompt,
  SessionReadError,
  SessionSummary,
  SessionSummaryWithPrompts,
  SessionTarget,
  SkippedRecord,
  SourceChanged,
  SourcedRecord,
  SourcePointer,
  StampedRecord,
  SystemPayload,
  ToolCallPayload,
  ToolResultPayload,
  Transcript,
  TranscriptEvent,
  TranscriptEventKind,
  TranscriptEventOf,
  TranscriptEventPayloads,
  TranscriptSession,
  TranscriptStreamPart,
  UnknownFormatGeneration,
  UnknownPayload,
  Usage
} from "@rivus/agent-kit-sessions/public";

export type LoadTranscriptOptions = ProviderOptions<Parameters<typeof contextLoadTranscript>[2]>;

export function loadTranscript(
  platform: Parameters<typeof contextLoadTranscript>[0],
  target: Parameters<typeof contextLoadTranscript>[1],
  options: LoadTranscriptOptions = {}
): ReturnType<typeof contextLoadTranscript> {
  return contextLoadTranscript(platform, target, {
    ...options,
    providers: { sessions: sessionsTable(options.providers), identity: identityTable(options.providers) }
  });
}

export function summarizeSession(
  platform: Parameters<typeof contextSummarizeSession>[0],
  target: Parameters<typeof contextSummarizeSession>[1],
  options: ProviderOptions<Parameters<typeof contextSummarizeSession>[2]> = {}
): ReturnType<typeof contextSummarizeSession> {
  return contextSummarizeSession(platform, target, {
    ...options,
    providers: { sessions: sessionsTable(options.providers), identity: identityTable(options.providers) }
  });
}
