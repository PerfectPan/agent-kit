/** Interfaces and shared helpers for provider implementations. */
export { discoverSessions } from "./application/services/discover-sessions.js";
export { EDGE_BYTES, readEdges } from "./application/services/files/edges.js";
export { catchIoFailure, guardIo } from "./application/services/files/io-failure.js";
export { type JsonlRecords, readJsonlRecords, readJsonlStream } from "./application/services/files/jsonl.js";
export {
  type ReadProgress,
  readBytes,
  readLines,
  readProgress,
  readText
} from "./application/services/files/read-file.js";
export { type WalkSpec, walkFiles } from "./application/services/files/walk.js";
export {
  type JsonlUsageLayout,
  decodeJsonlUsage,
  drain,
  fileSources,
  sameFile,
  usageStreamOf
} from "./application/services/usage-decoders/files.js";
export {
  type DecodeUsageOptions,
  type DiscoverOptions,
  type LoadOptions,
  type SessionAdapter,
  type SessionAdapters,
  type SessionPlatform,
  type SessionReadError,
  type SqliteUnavailable,
  type UsageDecodeError,
  type UsageDecodeFailure,
  type UsageDecoder,
  type UsageDecoders,
  type UsagePlatform,
  type UsageSource,
  type UsageSourceFailure,
  type UsageSourceOptions,
  type UsageStream,
  type UsageTarget
} from "./application/spi.js";
export { type ReadFailed } from "./domain/session/errors/session-read-error.js";
export { SESSION_TITLE_MAX } from "./domain/session/factories/session-head.js";
export { basenamePath, belowRoot, dirnamePath, joinPath } from "./domain/session/policies/paths.js";
export { type SessionHead, type SessionListError } from "./domain/session/value-objects/session-head.js";
export { type SessionPreview } from "./domain/session/value-objects/session-preview.js";
export { type SessionRef } from "./domain/session/value-objects/session-ref.js";
export {
  type SessionPromptsOptions,
  type SessionSummaryWithPrompts
} from "./domain/session/value-objects/session-summary.js";
export {
  type AcpToolState,
  type AcpUpdateField,
  type AcpUpdateValue,
  acpChunkText,
  acpMessageKind,
  acpRecordedUpdate,
  acpToolCallPayload,
  acpToolResultPayload,
  isAcpToolDone,
  isAcpToolError,
  mergeAcpToolStatus,
  mergeAcpToolUpdate
} from "./domain/transcript/adapters/acp-updates.js";
export { lenient } from "./domain/transcript/adapters/lenient.js";
export { recordTime, timedRecord } from "./domain/transcript/adapters/record-time.js";
export { logTimestamp, timeOfValue } from "./domain/transcript/adapters/timestamp.js";
export { type SourceChanged } from "./domain/transcript/errors/source-changed.js";
export {
  type UnknownFormatGeneration,
  unknownFormatGeneration
} from "./domain/transcript/errors/unknown-format-generation.js";
export {
  type ParsedTranscript,
  baseEvent,
  createTranscript,
  lineId,
  skipRecord
} from "./domain/transcript/factories/transcript-event.js";
export { shadowBefore } from "./domain/transcript/policies/compaction-shadowing.js";
export {
  type StampedRecord,
  type TimedRecord,
  assignSeq,
  inheritTimes,
  mergeByTime,
  mergeByTimeStream,
  timeOf
} from "./domain/transcript/policies/event-ordering.js";
export {
  latestSnapshot,
  promptSnapshot,
  snapshotHasSystemPrompt,
  snapshotHasTools
} from "./domain/transcript/policies/prompt-snapshot.js";
export { OUTPUT_KINDS, placeRequest } from "./domain/transcript/policies/request-placement.js";
export { markOrphanToolResults } from "./domain/transcript/policies/tool-result-pairing.js";
export { MAIN_LANE_ID, isPrompt, requestUsage } from "./domain/transcript/policies/turns.js";
export {
  addRequest,
  addTurnDuration,
  emptyPrompts,
  emptyTotals,
  finishPass
} from "./domain/transcript/services/fold-transcript.js";
export {
  type SkippedRecord,
  type SourcePointer,
  type SourcedRecord,
  sourceOf
} from "./domain/transcript/value-objects/source-pointer.js";
export { type TranscriptStreamPart } from "./domain/transcript/value-objects/stream-part.js";
export {
  type HookPayload,
  type MessagePayload,
  type PromptSnapshotPayload,
  type RequestPayload,
  type SystemPayload,
  type ToolCallPayload,
  type ToolResultPayload,
  type TranscriptEvent,
  type TranscriptEventBody,
  type TranscriptEventKind,
  type TranscriptEventOf
} from "./domain/transcript/value-objects/transcript-event.js";
export {
  type Capability,
  type Lane,
  type Transcript,
  type TranscriptSession
} from "./domain/transcript/value-objects/transcript.js";
export { type UsageFile, type UsageLineDecoder, rememberKey } from "./domain/usage/adapters/usage-lines.js";
export { decodeIsFinal } from "./domain/usage/policies/quiet.js";
export { shortHash } from "./domain/usage/services/short-hash.js";
export { type UsageCursor } from "./domain/usage/value-objects/usage-cursor.js";
export { type ModelUsage, type UsageRecord } from "./domain/usage/value-objects/usage-record.js";
export { type Usage, compactUsage } from "./domain/usage/value-objects/usage.js";
