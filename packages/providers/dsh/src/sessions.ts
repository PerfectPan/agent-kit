import { type Result, err, ok } from "@rivus/agent-kit-catalog/spi";
import {
  type Capability,
  type Lane,
  type LoadOptions,
  MAIN_LANE_ID,
  type ReadFailed,
  type SessionAdapter,
  type SessionHead,
  type SessionListFailure,
  type SessionPlatform,
  type SessionPromptsOptions,
  type SessionReadError,
  type SessionRef,
  type SessionSummaryWithPrompts,
  type SourcedRecord,
  type Transcript,
  type TranscriptEvent,
  type UnknownFormatGeneration,
  catchIoFailure,
  createTranscript,
  EDGE_BYTES,
  emptyPrompts,
  emptyTotals,
  finalizeTranscriptEvents,
  finishPass,
  readBytes,
  SESSION_TITLE_MAX,
  tallyTranscriptPart,
  walkFiles,
  unknownFormatGeneration
} from "@rivus/agent-kit-sessions/spi";

import { DSH_DISPLAY_NAME, DSH_ID } from "./facts.js";
import {
  DSH_SESSION_FILES,
  dshIsCompressed,
  dshRoots,
  dshSessionIdOf,
  latestGenerationKeeper,
  resolveDshChildPath
} from "./layout.js";
import { type DshSubagentCatalogValue, dshEventOf, dshHeaderOf, isDshSessionHeader } from "./records.js";
import { DSH_CAPABILITIES, type DshTranslation, createDshTranslation, dshCapabilities } from "./sessions/events.js";
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
      // Local subagent sessions are attached as lanes on their parent transcript, so hide them from the top-level list.
      if (preview.parentSession !== undefined) {
        continue;
      }
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

async function readDshRecords(
  platform: SessionPlatform,
  ref: SessionRef,
  signal: AbortSignal | undefined
): Promise<Result<ReturnType<typeof splitDshRecords>, SessionReadError>> {
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
  return ok(splitDshRecords(decoded.value.text, ref.path, decoded.value.codec));
}

function runDshRecords(
  records: readonly SourcedRecord[],
  translation: DshTranslation,
  onParts?: (parts: readonly TranscriptEvent[]) => void
): Result<void, UnknownFormatGeneration> {
  let last: number | undefined;
  for (const record of records) {
    const event = dshEventOf(record.value);
    const ts = event?.time ?? last ?? 1;
    last = ts;
    const step = translation.step(record, ts);
    if (!step.ok) {
      return step;
    }
    if (onParts !== undefined) {
      onParts(step.value);
    }
  }
  return ok(undefined);
}

/** Stable k-way merge by timestamp that preserves every source file's internal event order. */
function mergeLaneEvents(groups: readonly (readonly TranscriptEvent[])[]): TranscriptEvent[] {
  const cursors = groups.map(() => 0);
  const out: TranscriptEvent[] = [];
  for (;;) {
    let bestGroup = -1;
    let bestTs = Number.POSITIVE_INFINITY;
    for (let i = 0; i < groups.length; i += 1) {
      const group = groups[i]!;
      const cursor = cursors[i]!;
      if (cursor >= group.length) {
        continue;
      }
      const ts = group[cursor]!.ts;
      if (ts < bestTs) {
        bestTs = ts;
        bestGroup = i;
      }
    }
    if (bestGroup === -1) {
      break;
    }
    out.push(groups[bestGroup]![cursors[bestGroup]!]!);
    cursors[bestGroup]! += 1;
  }
  return out;
}

function unavailableLane(entry: DshSubagentCatalogValue, parentId: string): Lane {
  return {
    id: entry.childId,
    parentId,
    ...(entry.label === undefined ? {} : { title: entry.label }),
    unavailable: true
  };
}

async function loadDsh(
  platform: SessionPlatform,
  ref: SessionRef,
  options: LoadOptions = {}
): Promise<Result<Transcript, SessionReadError>> {
  const split = await readDshRecords(platform, ref, options.signal);
  if (!split.ok) {
    return split;
  }
  const { records, skipped } = split.value;
  if (records.length === 0) {
    return err(unknownFormatGeneration(DSH_ID, { file: ref.path, offset: 0, length: 0, line: 1 }));
  }
  const translation = createDshTranslation({
    retain: true,
    ...(ref.sessionId === undefined ? {} : { sessionId: ref.sessionId })
  });
  const ran = runDshRecords(records, translation);
  if (!ran.ok) {
    return ran;
  }
  const parsed = translation.finish();
  parsed.skipped.push(...skipped);

  const visited = new Set<string>([parsed.session.id, dshSessionIdOf(ref.path)]);
  const eventGroups: (readonly TranscriptEvent[])[] = [parsed.events];

  async function attachChildren(
    parentPath: string,
    parentLaneId: string,
    entries: readonly DshSubagentCatalogValue[]
  ): Promise<void> {
    for (const entry of entries) {
      options.signal?.throwIfAborted();
      if (entry.mode === "external" || visited.has(entry.childId)) {
        continue;
      }
      visited.add(entry.childId);
      const childPath = await resolveDshChildPath(platform, parentPath, entry.childId, options.signal);
      if (childPath === undefined) {
        parsed.agents.push(unavailableLane(entry, parentLaneId));
        continue;
      }
      const childSplit = await readDshRecords(
        platform,
        { agent: DSH_ID, path: childPath, sessionId: entry.childId },
        options.signal
      );
      if (!childSplit.ok || childSplit.value.records.length === 0) {
        parsed.agents.push(unavailableLane(entry, parentLaneId));
        continue;
      }
      const childTranslation = createDshTranslation({
        retain: true,
        sessionId: entry.childId,
        agentId: entry.childId,
        stripInheritedSeed: true
      });
      const childRan = runDshRecords(childSplit.value.records, childTranslation);
      if (!childRan.ok) {
        parsed.agents.push(unavailableLane(entry, parentLaneId));
        continue;
      }
      const childParsed = childTranslation.finish();
      const childSystemPrompt = childTranslation.systemPrompt();
      parsed.agents.push({
        id: entry.childId,
        parentId: parentLaneId,
        ...(entry.label === undefined ? {} : { title: entry.label }),
        ...(childSystemPrompt === undefined ? {} : { systemPrompt: childSystemPrompt })
      });
      eventGroups.push(childParsed.events);
      parsed.skipped.push(...childParsed.skipped, ...childSplit.value.skipped);
      await attachChildren(childPath, entry.childId, childTranslation.subagents());
    }
  }

  await attachChildren(ref.path, MAIN_LANE_ID, translation.subagents());

  if (eventGroups.length > 1) {
    const merged = mergeLaneEvents(eventGroups);
    finalizeTranscriptEvents(merged);
    parsed.events.length = 0;
    parsed.events.push(...merged);
    const lastEvent = merged.at(-1);
    if (lastEvent !== undefined) {
      parsed.session.endedAt =
        parsed.session.endedAt === undefined ? lastEvent.ts : Math.max(parsed.session.endedAt, lastEvent.ts);
    }
  }

  return ok(createTranscript(DSH_ID, dshCapabilities(parsed), parsed));
}

async function summarizeDsh(
  platform: SessionPlatform,
  ref: SessionRef,
  signal: AbortSignal | undefined,
  promptsOptions: SessionPromptsOptions | undefined
): Promise<Result<SessionSummaryWithPrompts, SessionReadError>> {
  const split = await readDshRecords(platform, ref, signal);
  if (!split.ok) {
    return split;
  }
  const { records } = split.value;
  if (records.length === 0) {
    return err(unknownFormatGeneration(DSH_ID, { file: ref.path, offset: 0, length: 0, line: 1 }));
  }
  const totals = emptyTotals();
  const prompts = emptyPrompts(promptsOptions);
  const noPrompts = emptyPrompts();
  const seen = new Set<Capability>();

  const translation = createDshTranslation({
    retain: false,
    ...(ref.sessionId === undefined ? {} : { sessionId: ref.sessionId })
  });
  let mainSessionId = ref.sessionId;
  const mainParts: TranscriptEvent[] = [];
  const ran = runDshRecords(records, translation, (parts) => {
    mainParts.push(...parts);
  });
  if (!ran.ok) {
    return ran;
  }
  const firstHeader = records[0] === undefined ? undefined : dshHeaderOf(records[0].value);
  if (firstHeader?.id !== undefined) {
    mainSessionId = firstHeader.id;
  }

  const visited = new Set<string>([dshSessionIdOf(ref.path)]);
  if (mainSessionId !== undefined) {
    visited.add(mainSessionId);
  }
  const laneGroups: (readonly TranscriptEvent[])[] = [mainParts];
  let subagentCount = 0;

  async function summarizeChildren(parentPath: string, entries: readonly DshSubagentCatalogValue[]): Promise<void> {
    for (const entry of entries) {
      signal?.throwIfAborted();
      if (entry.mode === "external" || visited.has(entry.childId)) {
        continue;
      }
      visited.add(entry.childId);
      subagentCount += 1;
      seen.add("subagents");
      const childPath = await resolveDshChildPath(platform, parentPath, entry.childId, signal);
      if (childPath === undefined) {
        continue;
      }
      const childSplit = await readDshRecords(
        platform,
        { agent: DSH_ID, path: childPath, sessionId: entry.childId },
        signal
      );
      if (!childSplit.ok || childSplit.value.records.length === 0) {
        continue;
      }
      const childTranslation = createDshTranslation({
        retain: false,
        sessionId: entry.childId,
        agentId: entry.childId,
        stripInheritedSeed: true
      });
      const childParts: TranscriptEvent[] = [];
      const childRan = runDshRecords(childSplit.value.records, childTranslation, (parts) => {
        childParts.push(...parts);
      });
      if (!childRan.ok) {
        continue;
      }
      laneGroups.push(childParts);
      await summarizeChildren(childPath, childTranslation.subagents());
    }
  }

  await summarizeChildren(ref.path, translation.subagents());

  const ordered = laneGroups.length > 1 ? mergeLaneEvents(laneGroups) : mainParts;
  for (const part of ordered) {
    if (part.agentId !== undefined && part.agentId !== MAIN_LANE_ID) {
      if (part.kind === "user") {
        continue;
      }
      tallyTranscriptPart(part, totals, noPrompts, seen);
    } else {
      tallyTranscriptPart(part, totals, prompts, seen);
    }
  }

  return ok(finishPass(totals, [...seen], subagentCount, prompts.list));
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
