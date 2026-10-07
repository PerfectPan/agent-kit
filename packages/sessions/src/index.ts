export * from "./public.js";

// Adapter building blocks, shared with sibling packages but not public until a consumer outside the kit needs them.
export { previewClaudeCodeRecords } from "./agents/claude-code/index.js";
export { discoverSessions, type DiscoverSessionsOptions } from "./application/discover-sessions.js";
export { EDGE_BYTES, edgeRecords, type FileEdges, readEdges } from "./application/files/edges.js";
export { type JsonlRecords, readJsonlRecords } from "./application/files/jsonl.js";
export {
  readBytes,
  readLines,
  type ReadOptions,
  type ReadProgress,
  readProgress,
  readText
} from "./application/files/read-file.js";
export { type WalkOptions, walkFiles, type WalkSpec } from "./application/files/walk.js";
export {
  assignSeq,
  baseEvent,
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
  timeOf,
  unknownFormatGeneration
} from "./domain/transcript/index.js";
export type { SessionPreview } from "./domain/session/index.js";
export { compactUsage } from "./domain/usage/index.js";
