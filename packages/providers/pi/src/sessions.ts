import { err, ok } from "@rivus/agent-kit-catalog/spi";
import {
  type SessionAdapter,
  type SessionPromptsOptions,
  type SessionRef,
  type SessionPlatform,
  createTranscript,
  discoverSessions,
  inheritTimes,
  readEdges,
  readSessionJsonl,
  recordTime,
  unknownFormatGeneration
} from "@rivus/agent-kit-sessions/spi";

import * as z from "zod/mini";

import { PI_DISPLAY_NAME, PI_ID } from "./facts.js";
import { PI_SESSION_FILES, piRoots } from "./layout.js";
import { PI_CAPABILITIES, createPiTranslation, piCapabilities } from "./sessions/events.js";
import { previewPiRecords } from "./sessions/preview.js";
import { summarizePi } from "./sessions/summarize.js";

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
    // Hand-written field checks instead of `piHeaderOf`, which accepts a header missing `version` or `timestamp`
    // and one carrying `createdAt`: detection must confirm a complete Pi header and tell it from a DeepSeek Harness
    // header (both are `type: "session"` in a `.jsonl` file), and `createdAt` is the distinguishing field.
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
  async load(platform, ref, options = {}) {
    const read = await readSessionJsonl(platform, ref.path, options);
    if (!read.ok) {
      return read;
    }
    const { records, skipped } = read.value;
    if (records.length === 0) {
      return err(unknownFormatGeneration(PI_ID, { file: ref.path, offset: 0, length: 0, line: 1 }));
    }
    const times = inheritTimes(records.map(recordTime));
    const translation = createPiTranslation({
      retain: true,
      ...(ref.sessionId === undefined ? {} : { sessionId: ref.sessionId })
    });
    for (const [index, record] of records.entries()) {
      const step = translation.step(record, times[index]!);
      if (!step.ok) {
        return step;
      }
    }
    const parsed = translation.finish();
    parsed.skipped.push(...skipped);
    options.signal?.throwIfAborted();
    return ok(createTranscript(PI_ID, piCapabilities(parsed), parsed));
  },
  summarize: (platform, ref, options = {}) =>
    summarizePi(platform, ref, options.signal, options.prompts as SessionPromptsOptions | undefined)
};
