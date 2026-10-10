// Use cases
export { listSessions, type ListSessionsOptions, sessionAdapterHome } from "./application/use-cases/list-sessions.js";
export {
  loadTranscript,
  type LoadTranscriptError,
  type LoadTranscriptOptions,
  type SessionTarget,
  summarizeSession
} from "./application/use-cases/load-transcript.js";
export { readOriginal, type ReadOriginalError } from "./application/use-cases/read-original.js";
export type { SessionErrorCode } from "./application/errors.js";
export {
  decodeUsage,
  isUsageRecord,
  isUsageSource,
  listUsageSources,
  type ListUsageSourcesOptions
} from "./application/use-cases/decode-usage.js";
export {
  type ScanUsageOptions,
  scanUsage,
  type UsageScan,
  type UsageScanSource,
  type UsageScanState
} from "./application/use-cases/scan-usage.js";

// Session adapters and usage ports
export { builtinSessionAdapters } from "./application/services/session-adapters/index.js";
export type {
  DecodeUsageOptions,
  SqliteUnavailable,
  UsageCursor,
  UsageDecodeError,
  UsageDecodeFailure,
  UsagePlatform,
  UsageSource,
  UsageSourceFailure,
  UsageSourceOptions,
  UsageStream,
  UsageTarget
} from "./application/usage-ports.js";
export type {
  DiscoverOptions,
  LoadOptions,
  SessionAdapter,
  SessionAdapters,
  SessionPlatform,
  SessionReadError
} from "./application/ports.js";

// Claude Code rules
export {
  CLAUDE_CODE_CAPABILITIES,
  type ClaudeCodeTranslateOptions,
  translateClaudeCodeRecords
} from "./domain/transcript/adapters/claude-code/events.js";
export { claudeCodeUsage } from "./domain/usage/adapters/claude-code.js";

// Codex rules
export {
  CODEX_CAPABILITIES,
  type CodexTranslateOptions,
  translateCodexRecords
} from "./domain/transcript/adapters/codex/events.js";
export { codexUsage } from "./domain/usage/adapters/codex.js";

// Grok rules
export {
  GROK_CAPABILITIES,
  type GrokTranslateOptions,
  translateGrokRecords
} from "./domain/transcript/adapters/grok/events.js";
export { grokUsage } from "./domain/usage/adapters/grok.js";

// Published language and the rules a viewer needs to interpret events
export {
  type CapabilityUnsupported,
  isSessionHead,
  type NoAdapterAccepted,
  type ReadFailed,
  SESSION_SUMMARY_VERSION,
  type SessionHead,
  type SessionListError,
  type SessionListFailure,
  type SessionNotFound,
  type SessionPromptsOptions,
  type SessionPrompt,
  type SessionRef,
  type SessionSummary,
  type SessionSummaryWithPrompts
} from "./domain/session/index.js";
export {
  CAPABILITIES,
  type Capability,
  type CompactionPayload,
  foldStreamParts,
  foldTranscript,
  type HookPayload,
  isPrompt,
  type Lane,
  laneOf,
  latestSnapshot,
  type LiveTranscriptEvent,
  MAIN_LANE_ID,
  mainAgentId,
  type MessagePayload,
  type ParsedTranscript,
  promptSnapshot,
  type PromptSnapshotPayload,
  promptStarts,
  type ReasoningPayload,
  recordKey,
  type RequestPayload,
  requestUsage,
  sessionPrompts,
  shadowedIn,
  type SkippedRecord,
  snapshotHasSystemPrompt,
  snapshotHasTools,
  type SourceChanged,
  type SourcedRecord,
  type SourcePointer,
  type StampedRecord,
  type SystemPayload,
  type ToolCallPayload,
  type ToolResultPayload,
  type Transcript,
  TRANSCRIPT_EVENT_KINDS,
  type TranscriptEvent,
  type TranscriptEventKind,
  type TranscriptSession,
  type TranscriptStreamPart,
  type UnknownFormatGeneration,
  type UnknownPayload
} from "./domain/transcript/index.js";
export {
  addUsage,
  type AiSdkUsage,
  type CostSource,
  type ModelUsage,
  noCacheInputTokens,
  type OtelAttributeOptions,
  toAiSdkUsage,
  toOtelAttributes,
  type Usage,
  type UsageGranularity,
  type UsageRecord
} from "./domain/usage/index.js";
