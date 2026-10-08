export * from "./public.js";

// Adapter building blocks, shared with sibling packages but not public until a consumer outside the kit needs them.
export { previewClaudeCodeRecords } from "./domain/adapters/claude-code/index.js";
export { discoverSessions, type DiscoverSessionsOptions } from "./application/use-cases/discover-sessions.js";
export { EDGE_BYTES, edgeRecords, type FileEdges, readEdges } from "./application/services/files/edges.js";
export { type JsonlRecords, readJsonlRecords } from "./application/services/files/jsonl.js";
export {
  readBytes,
  readLines,
  type ReadOptions,
  type ReadProgress,
  readProgress,
  readText
} from "./application/services/files/read-file.js";
export { type WalkOptions, walkFiles, type WalkSpec } from "./application/services/files/walk.js";
export { type AcpPartTranslator, createAcpPartTranslator } from "./domain/protocols/acp-updates.js";
export {
  assignSeq,
  baseEvent,
  createStreamFolder,
  createTranscript,
  type EventFields,
  inheritTimes,
  lineId,
  markOrphanToolResults,
  mergeByTime,
  placeRequest,
  shadowBefore,
  skipRecord,
  sourceOf,
  type StreamFolder,
  timeOf,
  unknownFormatGeneration
} from "./domain/transcript/index.js";
export type { SessionPreview } from "./domain/session/index.js";
export { builtinUsageDecoders } from "./application/services/usage-decoders/index.js";
export type { UsageDecoder, UsageDecoders } from "./application/usage-ports.js";
export { compactUsage } from "./domain/usage/index.js";
