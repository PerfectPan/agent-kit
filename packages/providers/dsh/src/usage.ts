import * as z from "zod/mini";
import { err, ok } from "@rivus/agent-kit-catalog/spi";
import {
  type DecodeUsageOptions,
  type JsonlUsageLayout,
  type ReadFailed,
  type SourcedRecord,
  type Usage,
  type UsageCursor,
  type UsageDecodeError,
  type UsageDecodeFailure,
  type UsageDecoder,
  type UsageFile,
  type UsageLineDecoder,
  type UsagePlatform,
  type UsageRecord,
  type UsageStream,
  type UsageTarget,
  basenamePath,
  decodeIsFinal,
  decodeJsonlUsage,
  drain,
  fileSources,
  guardIo,
  lenient,
  readBytes,
  sameFile,
  sourceOf,
  unknownFormatGeneration
} from "@rivus/agent-kit-sessions/spi";

import { DSH_ID, DSH_SESSION_VERSION } from "./facts.js";
import { DSH_SESSION_FILES, dshIsCompressed, dshRoots, dshSessionIdOf, latestGenerationKeeper } from "./layout.js";
import { dshAssistantOf, dshCompactionOf, dshEventOf, dshHeaderOf, dshRequestHeaderOf, dshUsageOf } from "./records.js";
import { decodeDshFrame, isDshFramePrefix, scanDshFrames, startsDshFrame } from "./records/zstd.js";

interface DshUsageState {
  /** The header's `id`; records fall back to the file's `<id>` directory name when it is missing. */
  sessionId: string | undefined;
  /** The model of the most recent `request/header`, for a message whose source names none. */
  model: string | undefined;
  /** The inherited prefix of a seeded session: events with an earlier time than the header's, already counted in the parent's file. */
  inheriting: boolean;
  /** A header was seen; only it sets the session id and the seeded state. */
  headerSeen: boolean;
  /** The time of the last event, for an event that records none. */
  lastTime: number | undefined;
  /** Decoded bytes consumed by the frames before the cursor, for the compressed path's offsets. */
  decodedBytes: number;
  /** The header's `createdAt`; a seeded fork's inherited events all precede it. */
  createdAt: number | undefined;
}

/** The state a cursor carries back, reading only the fields it understands. */
const DshSavedState = z.looseObject({
  sessionId: lenient(z.string()),
  model: lenient(z.string()),
  inheriting: lenient(z.boolean()),
  headerSeen: lenient(z.boolean()),
  lastTime: lenient(z.number()),
  decodedBytes: lenient(z.number()),
  createdAt: lenient(z.number())
});

/** A saved state is the decoder's own output, passed back through a cursor; a missing field starts at its default. */
function restoreDshState(saved: unknown): DshUsageState {
  const state = z.safeParse(DshSavedState, saved).data;
  return {
    sessionId: state?.sessionId,
    model: state?.model,
    lastTime: state?.lastTime,
    createdAt: state?.createdAt,
    inheriting: state?.inheriting ?? false,
    headerSeen: state?.headerSeen ?? false,
    decodedBytes: state?.decodedBytes ?? 0
  };
}

function readFailed(path: string, message: string): ReadFailed {
  return { _tag: "ReadFailed", path, message };
}

/**
 * DeepSeek Harness's usage over one session file: one `request` record per counted model call. Counted are the
 * `assistant/message` events whose `data.usage` is present, and the `compaction/summary` events that carry the
 * summarization call's `provider`, `model` and `usage` in their `data` (the `dsh-compaction-basic` plugin calls the
 * model with `purpose: "compaction"` outside the agent loop, so that call has no `assistant/message`); nothing else
 * counts. `dshUsageOf` adds the cache back into the input. A seeded session's inherited prefix is the parent's
 * copies, already counted in its file: only the leading run of events whose time precedes the header's `createdAt`
 * is skipped — the first event at or after it ends the skip for good, which lands the boundary after the fork's own
 * trailing `session/end-seed` marker even when the parent was itself a fork. The cut relies on the wall clock not
 * stepping back: a fork copies the seed first and then takes `createdAt = Date.now()`, and every later append also
 * takes `Date.now()`, so the fork's own events never precede its `createdAt`. Only the first header sets the
 * session id and the seeded state. The event's `seq`, unique in its session, is the request id. The model is the
 * message source's, or the most recent `request/header` when the source names none; `responseId` is the message id.
 */
function createDshUsageLines(file: UsageFile, state: DshUsageState): UsageLineDecoder {
  return {
    push(record: SourcedRecord) {
      const event = dshEventOf(record.value);
      if (event === undefined) {
        return ok([]);
      }
      const header = dshHeaderOf(record.value);
      if (header !== undefined) {
        if (header.version !== DSH_SESSION_VERSION) {
          return err(unknownFormatGeneration(DSH_ID, record));
        }
        if (!state.headerSeen) {
          state.sessionId = header.id;
          state.createdAt = header.createdAt;
          state.inheriting = header.isSeeded === true;
          state.headerSeen = true;
        }
        return ok([]);
      }
      const ts = event.time ?? state.lastTime ?? file.mtimeMs;
      state.lastTime = ts;
      if (event.type === "request/header") {
        const parsed = dshRequestHeaderOf(event.data);
        if (parsed?.config?.model !== undefined) {
          state.model = parsed.config.model;
        }
        return ok([]);
      }
      if (state.inheriting) {
        if (state.createdAt === undefined || ts < state.createdAt) {
          return ok([]);
        }
        state.inheriting = false;
      }
      let usage: Usage | undefined;
      let model: string | undefined;
      let provider: string | undefined;
      let responseId: string | undefined;
      if (event.type === "assistant/message") {
        const assistant = dshAssistantOf(event.data);
        usage = dshUsageOf(assistant?.usage);
        const message = assistant?.message;
        model = message?.source?.model ?? state.model;
        provider = message?.source?.provider;
        responseId = message?.id;
      } else if (event.type === "compaction/summary") {
        const compaction = dshCompactionOf(event.data);
        usage = dshUsageOf(compaction?.usage);
        model = compaction?.model;
        provider = compaction?.provider;
      } else {
        return ok([]);
      }
      if (usage === undefined) {
        return ok([]);
      }
      const out: UsageRecord = {
        agent: DSH_ID,
        sessionId: state.sessionId ?? file.sessionId,
        granularity: "request",
        timestamp: ts,
        usage,
        source: sourceOf(record)
      };
      const requestId = event.seq === undefined ? undefined : String(event.seq);
      if (requestId !== undefined) {
        out.requestId = requestId;
      }
      if (responseId !== undefined) {
        out.responseId = responseId;
      }
      if (model !== undefined) {
        out.model = model;
      }
      if (provider !== undefined) {
        out.provider = provider;
      }
      return ok([out]);
    },
    end() {
      // Every counted call is one complete event; nothing stays open where the file ends.
      return [];
    },
    save() {
      return structuredClone(state);
    }
  };
}

/** The shared line decoder over a file, with its state restored from a cursor. */
function dshUsageLines(file: UsageFile, saved?: unknown): UsageLineDecoder {
  return createDshUsageLines(file, restoreDshState(saved));
}

/** The key under which a scan counts a record once in its window: the session and the event seq, unique in its session. */
function dshUsageKey(record: UsageRecord): string | undefined {
  return record.requestId === undefined ? undefined : `${record.sessionId} ${record.requestId}`;
}

const layout: JsonlUsageLayout = {
  agent: DSH_ID,
  file: sameFile((path) => ({ sessionId: dshSessionIdOf(path) })),
  decoder: dshUsageLines
};

const encoder = new TextEncoder();

/**
 * Decodes a compressed session file as its concatenated Zstandard frames. The cursor's `offset` is the raw file
 * offset right after the last complete frame; its state keeps the decoded byte count, so resumed decodes continue
 * the decoded offsets and line numbers the records' sources use, computed the same way the sessions reader's
 * `splitDshRecords` computes them on the whole decoded text. A resume reads only the bytes after the cursor and
 * decodes only new frames, one at a time, without holding every frame's text. The writer appends one frame per
 * durable batch of whole JSONL lines, so a line never spans two complete frames and the torn final frame being
 * written — even when only its magic's first bytes are on disk — stays before the cursor.
 */
function decodeDshZstd(platform: UsagePlatform, target: UsageTarget, options: DecodeUsageOptions = {}): UsageStream {
  const { from, signal } = options;
  let cursor = (): UsageCursor | undefined => from;
  const failure = (error: UsageDecodeError): UsageDecodeFailure => ({ agent: DSH_ID, path: target.path, error });
  const changed = (at: UsageCursor): UsageDecodeFailure => ({
    agent: DSH_ID,
    path: target.path,
    error: { _tag: "SourceChanged", source: { file: target.path, offset: at.offset, length: 0, line: at.line } }
  });

  async function* run(): AsyncGenerator<UsageRecord | UsageDecodeFailure, void, undefined> {
    const io = guardIo(platform);
    try {
      signal?.throwIfAborted();
      const { path } = target;
      const info = await io.platform.fs.stat(path, { followSymlinks: true });
      if (info?.kind !== "file") {
        yield failure({ _tag: "SessionNotFound", path });
        return;
      }
      let offset = from?.offset ?? 0;
      let line = from?.line ?? 0;
      const state = restoreDshState(from?.state);
      let decodedAt = state.decodedBytes;
      const queue: UsageRecord[] = [...(from?.queue ?? [])];
      const decoder = createDshUsageLines({ path, sessionId: dshSessionIdOf(path), mtimeMs: info.mtimeMs }, state);
      const final = decodeIsFinal(options, info.mtimeMs);
      cursor = () => ({
        agent: DSH_ID,
        offset,
        line,
        state: decoder.save(),
        ...(queue.length > 0 ? { queue: [...queue] } : {})
      });
      if (from !== undefined && from.offset > info.size) {
        cursor = () => undefined;
        yield changed(from);
        return;
      }
      yield* drain(queue);
      if (offset === info.size) {
        queue.push(...decoder.end(final));
        yield* drain(queue);
        return;
      }
      const bytes = await readBytes(io.platform, path, { start: offset, end: info.size }, signal ? { signal } : {});
      if (bytes.length === 0) {
        // The file shrank back to the cursor since the stat; there is nothing new to decode.
        queue.push(...decoder.end(final));
        yield* drain(queue);
        return;
      }
      if (!startsDshFrame(bytes)) {
        if (isDshFramePrefix(bytes)) {
          // A new frame is being written, with only its magic's first bytes on disk; the cursor stays before it.
          queue.push(...decoder.end(final));
          yield* drain(queue);
          return;
        }
        if (from !== undefined) {
          // The cursor is not at a frame start: the file was rewritten.
          cursor = () => undefined;
          yield changed(from);
          return;
        }
        yield failure(readFailed(path, "the session file could not be decoded"));
        return;
      }
      const frames = scanDshFrames(bytes);
      if (frames === undefined || frames.length === 0) {
        // A torn first frame is still being written; the cursor stays before it.
        queue.push(...decoder.end(final));
        yield* drain(queue);
        return;
      }
      const startOffset = offset;
      // One frame is one durable batch of whole lines. Each frame's text ends with the newline that terminates its
      // last line, so the trailing empty fragment of its split is not a line; the remaining pieces are exactly the
      // joined text's lines, with `splitDshRecords`' numbering (every piece counts, empty ones too) and its byte
      // accounting (offset + length + 1 per line). A frame's records are decoded whole before the cursor moves
      // past it, and its drained-then-yielded records sit in the queue meanwhile, so a decode that stops mid-frame
      // resumes with the rest of the queue and never replays a record.
      for (let at = 0; at < frames.length; at++) {
        const text = decodeDshFrame(io.platform, bytes, frames[at]!);
        if (text === undefined) {
          yield failure(readFailed(path, "the session file could not be decoded"));
          return;
        }
        const elements = text.split("\n");
        const pieces = text.endsWith("\n") ? elements.slice(0, -1) : elements;
        for (const piece of pieces) {
          const length = encoder.encode(piece).byteLength;
          line += 1;
          if (piece.trim().length > 0) {
            let value: unknown;
            try {
              value = JSON.parse(piece) as unknown;
            } catch {
              value = undefined;
            }
            if (value !== undefined) {
              const pushed = decoder.push({
                value,
                file: path,
                offset: decodedAt,
                length,
                line,
                codec: "zstd"
              });
              if (!pushed.ok) {
                // The frame cannot be decoded further. Drop the cursor before draining the records its earlier
                // lines produced: a consumer that stops mid-drain must see no cursor, because one pointing past
                // some of the frame's lines would replay them with wrong numbers on every resume. The next decode
                // reads the file from its start.
                cursor = () => undefined;
                yield* drain(queue);
                yield failure(pushed.error);
                return;
              }
              queue.push(...pushed.value);
            }
          }
          decodedAt += length + 1;
        }
        offset = startOffset + frames[at]!.end;
        state.decodedBytes = decodedAt;
        yield* drain(queue);
      }
      queue.push(...decoder.end(final));
      yield* drain(queue);
    } catch (error) {
      signal?.throwIfAborted();
      const ioFailure = io.failure(error, target.path);
      if (!ioFailure) {
        throw error;
      }
      yield failure(ioFailure);
    }
  }

  return {
    get cursor() {
      return cursor();
    },
    [Symbol.asyncIterator]: () => run()
  };
}

/**
 * DeepSeek Harness stores one append-only, optionally Zstandard-compressed JSONL log per session under
 * `<home>/sessions/<encoded cwd>/<id>/session.v4.jsonl[.zstd]`; `dshUsageOf` fixes the counts, and the decoder
 * skips the inherited events a seeded session starts with.
 */
export const dshUsageDecoder: UsageDecoder = {
  specificationVersion: "usage-v1",
  agent: DSH_ID,
  usageKey: dshUsageKey,
  sources(platform, home, options = {}) {
    return fileSources(platform, DSH_ID, dshRoots(home), DSH_SESSION_FILES, {
      ...options,
      // Every session stores its log under the same file name. dsh's `findLog` refuses the same id in several
      // project directories, so the `<id>` directory name plus the file name identifies the session uniquely.
      identify: (path) => `${dshSessionIdOf(path)}/${basenamePath(path)}`,
      keep: latestGenerationKeeper()
    });
  },
  decode(platform, target, options = {}) {
    return dshIsCompressed(target.path)
      ? decodeDshZstd(platform, target, options)
      : decodeJsonlUsage(platform, target, layout, options);
  }
};
