// Use cases
export { listSessions, type ListSessionsOptions } from "./application/list-sessions.js";
export {
  loadTranscript,
  type LoadTranscriptError,
  type LoadTranscriptOptions,
  type SessionTarget,
  summarizeSession
} from "./application/load-transcript.js";
export { readOriginal, type ReadOriginalError } from "./application/read-original.js";
export type { SessionErrorCode } from "./application/errors.js";

// Session adapters
export { builtinSessionAdapters } from "./application/session-adapters/index.js";
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
  claudeCodeUsage,
  type ClaudeCodeTranslateOptions,
  translateClaudeCodeRecords
} from "./agents/claude-code/index.js";

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
  type SessionRef,
  type SessionSummary
} from "./domain/session/index.js";
export {
  CAPABILITIES,
  type Capability,
  type CompactionPayload,
  foldTranscript,
  type HookPayload,
  isPrompt,
  type Lane,
  laneOf,
  latestSnapshot,
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
  type UnknownFormatGeneration,
  type UnknownPayload
} from "./domain/transcript/index.js";
export type { Usage } from "./domain/usage/index.js";
