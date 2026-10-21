export type { CapabilityUnsupported } from "@rivus/agent-kit-catalog";

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
export type {
  DecodeUsageOptions,
  SqliteUnavailable,
  UsageCursor,
  UsageDecodeError,
  UsageDecodeFailure,
  UsageDecoder,
  UsagePlatform,
  UsageSource,
  UsageSourceFailure,
  UsageSourceOptions,
  UsageStream,
  UsageTarget
} from "./application/spi.js";
export type {
  DiscoverOptions,
  LoadOptions,
  SessionAdapter,
  SessionAdapters,
  SessionPlatform,
  SessionReadError
} from "./application/spi.js";

// Published language and the rules a viewer needs to interpret events
export {
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
  type TranscriptEventOf,
  type TranscriptEventPayloads,
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
