export type { CapabilityUnsupported } from "@rivus/agent-kit-catalog/public";

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
  type SessionHead,
  type SessionListError,
  type SessionListFailure
} from "./domain/session/value-objects/session-head.js";
export {
  type NoAdapterAccepted,
  type ReadFailed,
  type SessionNotFound
} from "./domain/session/errors/session-read-error.js";
export {
  SESSION_SUMMARY_VERSION,
  type SessionPromptsOptions,
  type SessionPrompt,
  type SessionSummary,
  type SessionSummaryWithPrompts
} from "./domain/session/value-objects/session-summary.js";
export { type SessionRef } from "./domain/session/value-objects/session-ref.js";
export {
  CAPABILITIES,
  type Capability,
  type Lane,
  type Transcript,
  type TranscriptSession
} from "./domain/transcript/value-objects/transcript.js";
export {
  type CompactionPayload,
  type HookPayload,
  type MessagePayload,
  type PromptSnapshotPayload,
  type ReasoningPayload,
  type RequestPayload,
  type SystemPayload,
  type ToolCallPayload,
  type ToolResultPayload,
  TRANSCRIPT_EVENT_KINDS,
  type TranscriptEvent,
  type TranscriptEventKind,
  type TranscriptEventOf,
  type TranscriptEventPayloads,
  type UnknownPayload
} from "./domain/transcript/value-objects/transcript-event.js";
export { foldStreamParts } from "./domain/transcript/services/fold-stream-parts.js";
export { foldTranscript } from "./domain/transcript/services/fold-transcript.js";
export {
  isPrompt,
  laneOf,
  MAIN_LANE_ID,
  mainAgentId,
  promptStarts,
  recordKey,
  requestUsage,
  sessionPrompts
} from "./domain/transcript/policies/turns.js";
export {
  latestSnapshot,
  promptSnapshot,
  snapshotHasSystemPrompt,
  snapshotHasTools
} from "./domain/transcript/policies/prompt-snapshot.js";
export { type LiveTranscriptEvent, type TranscriptStreamPart } from "./domain/transcript/value-objects/stream-part.js";
export { type ParsedTranscript } from "./domain/transcript/factories/transcript-event.js";
export { shadowedIn } from "./domain/transcript/policies/compaction-shadowing.js";
export {
  type SkippedRecord,
  type SourcedRecord,
  type SourcePointer
} from "./domain/transcript/value-objects/source-pointer.js";
export { type SourceChanged } from "./domain/transcript/errors/source-changed.js";
export { type StampedRecord } from "./domain/transcript/policies/event-ordering.js";
export { type UnknownFormatGeneration } from "./domain/transcript/errors/unknown-format-generation.js";
export { addUsage } from "./domain/usage/services/add-usage.js";
export { type AiSdkUsage, toAiSdkUsage } from "./domain/usage/services/to-ai-sdk-usage.js";
export {
  type CostSource,
  type ModelUsage,
  type UsageGranularity,
  type UsageRecord
} from "./domain/usage/value-objects/usage-record.js";
export { noCacheInputTokens } from "./domain/usage/services/no-cache-input.js";
export { type OtelAttributeOptions, toOtelAttributes } from "./domain/usage/services/to-otel-attributes.js";
export { type Usage } from "./domain/usage/value-objects/usage.js";

export { type AcpPartTranslator, createAcpPartTranslator } from "./domain/transcript/adapters/acp-updates.js";
export { type StreamFolder, createStreamFolder } from "./domain/transcript/services/fold-stream-parts.js";
export { mergeByTime } from "./domain/transcript/policies/event-ordering.js";
export { timedRecord } from "./domain/transcript/adapters/record-time.js";
export { readLines, readText } from "./application/services/files/read-file.js";
