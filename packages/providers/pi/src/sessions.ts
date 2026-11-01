import { type Result, err, ok } from "@rivus/agent-kit-catalog/spi";
import {
  type LoadOptions,
  type SessionAdapter,
  type SessionPromptsOptions,
  type SessionReadError,
  type SessionRef,
  type SessionPlatform,
  type Transcript,
  catchIoFailure,
  createTranscript,
  discoverSessions,
  inheritTimes,
  readEdges,
  readJsonlRecords,
  readProgress,
  recordTime,
  unknownFormatGeneration
} from "@rivus/agent-kit-sessions/spi";

import * as z from "zod/mini";

import { PI_DISPLAY_NAME, PI_ID } from "./facts.js";
import { PI_SESSION_FILES, piRoots } from "./layout.js";
import { PI_CAPABILITIES, createPiTranslation, piCapabilities } from "./sessions/events.js";
import { previewPiRecords } from "./sessions/preview.js";
import { summarizePi } from "./sessions/summarize.js";

async function loadPi(
  platform: SessionPlatform,
  ref: SessionRef,
  options: LoadOptions = {}
): Promise<Result<Transcript, SessionReadError>> {
  const progress = readProgress(options.onProgress);
  const read = await catchIoFailure(platform, ref.path, options.signal, (guarded) =>
    readJsonlRecords(guarded, ref.path, { signal: options.signal, progress })
  );
  if (!read.ok) {
    return read;
  }
  const { records, skipped } = read.value;
  if (records.length === 0) {
    return err(unknownFormatGeneration(PI_ID, { file: ref.path, offset: 0, length: 0, line: 1 }));
  }
  const translation = createPiTranslation({
    retain: true,
    ...(ref.sessionId === undefined ? {} : { sessionId: ref.sessionId })
  });
  const times = inheritTimes(records.map(recordTime));
  for (let index = 0; index < records.length; index++) {
    const step = translation.step(records[index]!, times[index]!);
    if (!step.ok) {
      return step;
    }
  }
  const parsed = translation.finish();
  parsed.skipped.push(...skipped);
  return ok(createTranscript(PI_ID, piCapabilities(parsed), parsed));
}

/** A Pi file starts with its `session` header. Reading only the head keeps detection cheap. */
async function detectPi(platform: SessionPlatform, ref: SessionRef): Promise<boolean> {
  if (!ref.path.endsWith(".jsonl")) {
    return false;
  }
  const edges = await readEdges(platform, ref.path);
  if (edges === undefined) {
    return false;
  }
  const line = edges.head.split("\n").find((candidate) => candidate.trim().length > 0);
  if (line === undefined) {
    return false;
  }
  try {
    const value: unknown = JSON.parse(line);
    const record = z.safeParse(z.record(z.string(), z.unknown()), value).data;
    return (
      record !== undefined &&
      record.type === "session" &&
      typeof record.version === "number" &&
      (typeof record.timestamp === "string" || typeof record.timestamp === "number") &&
      !Object.hasOwn(record, "createdAt")
    );
  } catch {
    return false;
  }
}

/**
 * Pi keeps one append-only JSONL file per session, a tree linked by `id`/`parentId`, under
 * `<home>/sessions/<encoded cwd>/<time>_<id>.jsonl`. The file has no sidecars; the header carries the id, cwd and
 * start time.
 */
export const piSessionAdapter: SessionAdapter = {
  specificationVersion: "sessions-v1",
  agent: PI_ID,
  displayName: PI_DISPLAY_NAME,
  capabilities: PI_CAPABILITIES,
  roots: piRoots,
  discover(platform, root, options = {}) {
    return discoverSessions(platform, PI_ID, root, {
      ...options,
      files: PI_SESSION_FILES,
      preview: previewPiRecords
    });
  },
  detect: detectPi,
  load: loadPi,
  summarize: (platform, ref, options = {}) =>
    summarizePi(platform, ref, options.signal, options.prompts as SessionPromptsOptions | undefined)
};
