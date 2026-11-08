import { type Result, err, ok } from "@rivus/agent-kit-catalog/spi";
import {
  type Capability,
  type LoadOptions,
  type ReadFailed,
  type SessionAdapter,
  type SessionHead,
  type SessionListFailure,
  type SessionPlatform,
  type SessionPromptsOptions,
  type SessionReadError,
  type SessionRef,
  type SessionSummaryWithPrompts,
  type Transcript,
  catchIoFailure,
  addRequest,
  createTranscript,
  emptyPrompts,
  emptyTotals,
  finishPass,
  EDGE_BYTES,
  isPrompt,
  readBytes,
  requestUsage,
  SESSION_TITLE_MAX,
  walkFiles,
  unknownFormatGeneration
} from "@rivus/agent-kit-sessions/spi";

import { DSH_DISPLAY_NAME, DSH_ID } from "./facts.js";
import { DSH_SESSION_FILES, dshIsCompressed, dshRoots, latestGenerationKeeper } from "./layout.js";
import { dshEventOf, dshHeaderOf, isDshSessionHeader } from "./records.js";
import { DSH_CAPABILITIES, createDshTranslation, dshCapabilities } from "./sessions/events.js";
import { previewDshText } from "./sessions/preview.js";
import { splitDshRecords } from "./sessions/read.js";
import { readDshHead, readDshText } from "./records/zstd.js";

function readFailed(path: string, message: string, cause?: unknown): ReadFailed {
  return {
    _tag: "ReadFailed",
    path,
    message,
    ...(cause === undefined ? {} : { cause })
  };
}

/** The failure a compressed source reports when the host has no decoder or the bytes do not decode. */
function undecodable(path: string, reason: "no-decompressor" | "decode-failed"): ReadFailed {
  return readFailed(
    path,
    reason === "no-decompressor"
      ? "zstd decompression is not available on this platform"
      : "the session file could not be decoded"
  );
}

function failure(path: string, error: ReadFailed): SessionListFailure {
  return { ref: { agent: DSH_ID, path }, error };
}

function headOf(
  path: string,
  preview: ReturnType<typeof previewDshText>,
  file: { size: number; mtimeMs: number }
): SessionHead {
  const title = preview.title ?? preview.firstPrompt;
  return {
    ref: {
      agent: DSH_ID,
      path,
      ...(preview.sessionId === undefined ? {} : { sessionId: preview.sessionId })
    },
    lastActiveAt: preview.lastAt ?? file.mtimeMs,
    sizeBytes: file.size,
    ...(title === undefined ? {} : { title: title.slice(0, SESSION_TITLE_MAX) }),
    ...(preview.cwd === undefined ? {} : { cwd: preview.cwd }),
    ...(preview.startedAt === undefined ? {} : { startedAt: preview.startedAt }),
    ...(preview.firstPrompt === undefined ? {} : { firstPrompt: preview.firstPrompt })
  };
}

/**
 * Discovery reads the frames in each file's first 64 KB, then previews the decoded prefix. It never reads a whole
 * log, so a large session costs one head slice.
 */
async function* discoverDsh(
  platform: SessionPlatform,
  root: string,
  options: { signal?: AbortSignal; onTotal?: (files: number) => void } = {}
): AsyncGenerator<SessionHead | SessionListFailure, void, undefined> {
  if ((await platform.fs.stat(root, { followSymlinks: true })) === undefined) {
    yield { ref: { agent: DSH_ID, path: root }, error: { _tag: "RootMissing", path: root } };
    return;
  }
  const failures: SessionListFailure[] = [];
  let paths: string[];
  try {
    paths = await walkFiles(platform, root, DSH_SESSION_FILES, {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      onError: (dir, error) => failures.push(failure(dir, readFailed(dir, String(error), error)))
    });
  } catch (error) {
    options.signal?.throwIfAborted();
    yield failure(root, readFailed(root, String(error), error));
    return;
  }
  for (const item of failures) {
    yield item;
  }
  // After a format migration both generations stay in the `<id>` directory, so only the newest generation lists:
  // the selection `latestGenerationKeeper` makes, shared with the usage decoder, so a file discovery previews is one
  // `load` can open. A directory that holds only an older generation still lists it, and `load` reports
  // `UnknownFormatGeneration` for it.
  const keep = latestGenerationKeeper();
  const listed = new Set(paths);
  paths = paths.filter((path) => keep(path, listed));
  options.onTotal?.(paths.length);
  for (const path of paths) {
    options.signal?.throwIfAborted();
    try {
      const stat = await platform.fs.stat(path, { followSymlinks: true });
      if (stat?.kind !== "file") {
        continue;
      }
      const head = await readDshHead(platform, path, stat.size, { signal: options.signal });
      if (head === undefined || "undecodable" in head) {
        yield failure(
          path,
          head === undefined
            ? readFailed(path, "the session file could not be decoded")
            : undecodable(path, head.undecodable)
        );
        continue;
      }
      // A compressed head that holds no complete frame, or whose decoded prefix exceeds the preview budget, has
      // nothing to preview: the head keeps the file's mtime as its last activity, like a compressed tail does.
      const preview = previewDshText("text" in head ? head.text : "");
      // A plain log's tail holds its last activity; the head alone would report only the start. A compressed tail is
      // not a frame boundary, so a compressed log keeps the file's mtime as its last activity.
      if (!dshIsCompressed(path) && stat.size > EDGE_BYTES) {
        const tail = await readBytes(
          platform,
          path,
          { start: stat.size - EDGE_BYTES, end: stat.size },
          { signal: options.signal }
        );
        const last = new TextDecoder()
          .decode(tail)
          .split("\n")
          .filter((line) => line.trim().length > 0)
          .at(-1);
        if (last !== undefined) {
          try {
            const time = dshEventOf(JSON.parse(last) as unknown)?.time;
            if (time !== undefined) {
              preview.lastAt = preview.lastAt === undefined ? time : Math.max(preview.lastAt, time);
            }
          } catch {
            // A cut first line of the tail is not a record; the head still describes the session.
          }
        }
      }
      yield headOf(path, preview, stat);
    } catch (error) {
      options.signal?.throwIfAborted();
      yield failure(path, readFailed(path, String(error), error));
    }
  }
}

async function loadDsh(
  platform: SessionPlatform,
  ref: SessionRef,
  options: LoadOptions = {}
): Promise<Result<Transcript, SessionReadError>> {
  const decoded = await catchIoFailure(platform, ref.path, options.signal, (guarded) =>
    readDshText(guarded, ref.path, { signal: options.signal })
  );
  if (!decoded.ok) {
    return decoded;
  }
  if (decoded.value === undefined) {
    return err(readFailed(ref.path, "the session file could not be decoded"));
  }
  if ("undecodable" in decoded.value) {
    return err(undecodable(ref.path, decoded.value.undecodable));
  }
  const { records, skipped } = splitDshRecords(decoded.value.text, ref.path, decoded.value.codec);
  if (records.length === 0) {
    return err(unknownFormatGeneration(DSH_ID, { file: ref.path, offset: 0, length: 0, line: 1 }));
  }
  const translation = createDshTranslation({
    retain: true,
    ...(ref.sessionId === undefined ? {} : { sessionId: ref.sessionId })
  });
  let last: number | undefined;
  for (const record of records) {
    const event = dshEventOf(record.value);
    const ts = event?.time ?? last ?? 1;
    last = ts;
    const step = translation.step(record, ts);
    if (!step.ok) {
      return step;
    }
  }
  const parsed = translation.finish();
  parsed.skipped.push(...skipped);
  return ok(createTranscript(DSH_ID, dshCapabilities(parsed), parsed));
}

async function summarizeDsh(
  platform: SessionPlatform,
  ref: SessionRef,
  signal: AbortSignal | undefined,
  promptsOptions: SessionPromptsOptions | undefined
): Promise<Result<SessionSummaryWithPrompts, SessionReadError>> {
  const decoded = await catchIoFailure(platform, ref.path, signal, (guarded) =>
    readDshText(guarded, ref.path, { signal })
  );
  if (!decoded.ok) {
    return decoded;
  }
  if (decoded.value === undefined) {
    return err(readFailed(ref.path, "the session file could not be decoded"));
  }
  if ("undecodable" in decoded.value) {
    return err(undecodable(ref.path, decoded.value.undecodable));
  }
  const { records } = splitDshRecords(decoded.value.text, ref.path, decoded.value.codec);
  const translation = createDshTranslation({
    retain: false,
    ...(ref.sessionId === undefined ? {} : { sessionId: ref.sessionId })
  });
  const totals = emptyTotals();
  const prompts = emptyPrompts(promptsOptions);
  const seen = new Set<Capability>();
  let last: number | undefined;
  let sawHeader = false;
  for (const record of records) {
    const event = dshEventOf(record.value);
    if (dshHeaderOf(record.value) !== undefined) {
      sawHeader = true;
    }
    const ts = event?.time ?? last ?? 1;
    last = ts;
    const step = translation.step(record, ts);
    if (!step.ok) {
      return err(step.error);
    }
    for (const part of step.value) {
      if (part.kind === "request") {
        addRequest(totals, requestUsage(part));
        seen.add("requests");
        if (part.payload.usage !== undefined) {
          seen.add("usage");
        }
      } else if (part.kind === "compaction") {
        totals.compactions += 1;
        seen.add("compaction");
        if (part.payload.preTokens !== undefined || part.payload.postTokens !== undefined) {
          seen.add("compactionTokens");
        }
      } else if (part.kind === "reasoning") {
        seen.add("reasoning");
      } else if (part.kind === "system") {
        if (part.payload.text !== undefined) {
          seen.add("systemPrompt");
        }
        if (Array.isArray(part.payload.tools)) {
          seen.add("toolSchemas");
        }
      } else if (part.kind === "tool_result" && part.payload.isError === true) {
        totals.failedTools += 1;
      } else if (part.kind === "user" && isPrompt(part)) {
        totals.turns += 1;
        prompts.add(part.payload.text ?? "");
      }
    }
  }
  if (!sawHeader) {
    return err(unknownFormatGeneration(DSH_ID, { file: ref.path, offset: 0, length: 0, line: 1 }));
  }
  const capabilities = DSH_CAPABILITIES.filter((capability) => seen.has(capability));
  return ok(finishPass(totals, capabilities, 0, prompts.list));
}

async function detectDsh(platform: SessionPlatform, ref: SessionRef): Promise<boolean> {
  if (!ref.path.includes("session")) {
    return false;
  }
  let head: Awaited<ReturnType<typeof readDshHead>>;
  try {
    head = await readDshHead(platform, ref.path, Number.MAX_SAFE_INTEGER);
  } catch {
    return false;
  }
  if (head === undefined || "undecodable" in head) {
    return false;
  }
  if (!("text" in head)) {
    // A compressed session whose first frame spans past the head cap decodes no text, but the file name pattern
    // and the zstd frame magic identify it; decoding the whole file would cost a read detection does not need.
    return true;
  }
  const line = head.text.split("\n").find((candidate) => candidate.trim().length > 0);
  if (line === undefined) {
    return false;
  }
  try {
    return isDshSessionHeader(JSON.parse(line) as unknown);
  } catch {
    return false;
  }
}

/**
 * DeepSeek Harness stores one append-only, optionally Zstandard-compressed JSONL log per session under
 * `<home>/sessions/<encoded cwd>/<id>/session.v4.jsonl.zstd`. Each row is a session event; the header is v4.
 */
export const dshSessionAdapter: SessionAdapter = {
  specificationVersion: "sessions-v1",
  agent: DSH_ID,
  displayName: DSH_DISPLAY_NAME,
  capabilities: DSH_CAPABILITIES,
  roots: dshRoots,
  discover: discoverDsh,
  detect: detectDsh,
  load: loadDsh,
  summarize: (platform, ref, options = {}) =>
    summarizeDsh(platform, ref, options.signal, options.prompts as SessionPromptsOptions | undefined)
};
