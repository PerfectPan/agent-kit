import { err, ok, type Result } from "@rivus/agent-kit-catalog";

import {
  GROK_SESSION_FILES,
  type GrokSessionMeta,
  type GrokSubagentMeta,
  grokRoots,
  grokSessionDir,
  grokSubagentMeta,
  grokSummaryFields,
  grokSummaryPath,
  grokUpdatesPath
} from "../../../domain/session/adapters/grok/layout.js";
import { applyGrokSummary, previewGrokRecords } from "../../../domain/session/adapters/grok/preview.js";
import {
  GROK_CAPABILITIES,
  grokCapabilities,
  translateGrokRecords
} from "../../../domain/transcript/adapters/grok/events.js";
import { summarizeGrokRecords } from "../../../domain/transcript/adapters/grok/summarize.js";
import {
  joinPath,
  type SessionHead,
  type SessionPromptsOptions,
  type SessionRef,
  type SessionSummaryWithPrompts
} from "../../../domain/session/index.js";
import {
  createTranscript,
  mergeByTimeStream,
  type SkippedRecord,
  type StampedRecord,
  type Transcript,
  type UnknownFormatGeneration
} from "../../../domain/transcript/index.js";
import { timedRecord } from "../../../domain/transcript/adapters/record-time.js";
import { discoverSessions } from "../discover-sessions.js";
import { EDGE_BYTES } from "../files/edges.js";
import { catchIoFailure } from "../files/io-failure.js";
import { type JsonlRecords, readJsonlRecords, readJsonlStream } from "../files/jsonl.js";
import { type ReadProgress, readProgress, readText } from "../files/read-file.js";
import type { LoadOptions, SessionAdapter, SessionPlatform, SessionReadError } from "../../ports.js";

const AGENT = "grok";

/** `undefined` when `text` is not JSON. The caller records an `invalid-json` skip. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function textSource(path: string, text: string): SkippedRecord["source"] {
  return { file: path, offset: 0, length: new TextEncoder().encode(text).byteLength, line: 1 };
}

async function readIfFile(
  platform: SessionPlatform,
  path: string,
  options: { signal?: AbortSignal; progress: ReadProgress }
): Promise<string | undefined> {
  if ((await platform.fs.stat(path, { followSymlinks: true }))?.kind !== "file") {
    return undefined;
  }
  return readText(platform, path, options);
}

/**
 * `summary.json` and `tool_definitions.json` that are not JSON become `invalid-json` skips. A summary whose
 * `chat_format_version` this adapter does not read is returned as `generation` for the caller to pass through.
 */
async function loadMeta(
  platform: SessionPlatform,
  dir: string,
  options: { signal?: AbortSignal; progress: ReadProgress }
): Promise<Pick<GrokSessionFiles, "meta" | "skipped" | "generation">> {
  const skipped: SkippedRecord[] = [];
  const summaryPath = grokSummaryPath(dir);
  const summaryText = await readIfFile(platform, summaryPath, options);
  const meta: GrokSessionMeta = {};
  if (summaryText !== undefined) {
    const source = textSource(summaryPath, summaryText);
    const value = parseJson(summaryText);
    if (value === undefined) {
      skipped.push({ reason: "invalid-json", source });
    } else {
      const parsed = grokSummaryFields(value, source);
      if (!parsed.ok) {
        return { meta, skipped, generation: parsed.error };
      }
      Object.assign(meta, parsed.value);
    }
  }
  const prompt = await readIfFile(platform, joinPath(dir, "system_prompt.txt"), options);
  if (prompt && prompt.length > 0) {
    meta.systemPrompt = prompt;
  }
  const toolsPath = joinPath(dir, "tool_definitions.json");
  const toolsText = await readIfFile(platform, toolsPath, options);
  if (toolsText !== undefined) {
    const value = parseJson(toolsText);
    if (value === undefined) {
      skipped.push({ reason: "invalid-json", source: textSource(toolsPath, toolsText) });
    } else {
      meta.tools = value;
    }
  }
  return { meta, skipped };
}

async function readSubagentMetas(
  platform: SessionPlatform,
  sessionDir: string,
  options: { signal?: AbortSignal; progress: ReadProgress },
  skipped: SkippedRecord[]
): Promise<Map<string, GrokSubagentMeta>> {
  const out = new Map<string, GrokSubagentMeta>();
  const dir = joinPath(sessionDir, "subagents");
  if ((await platform.fs.stat(dir, { followSymlinks: true }))?.kind !== "dir") {
    return out;
  }
  for (const entry of await platform.fs.list(dir)) {
    if (entry.kind !== "dir") {
      continue;
    }
    const metaPath = joinPath(joinPath(dir, entry.name), "meta.json");
    const text = await readIfFile(platform, metaPath, options);
    if (!text) {
      continue;
    }
    const value = parseJson(text);
    if (value === undefined) {
      skipped.push({ reason: "invalid-json", source: textSource(metaPath, text) });
      continue;
    }
    out.set(entry.name, grokSubagentMeta(value));
  }
  return out;
}

async function readSession(
  platform: SessionPlatform,
  ref: SessionRef,
  signal: AbortSignal | undefined,
  progress: ReadProgress
): Promise<GrokSessionFiles> {
  const options = { signal, progress };
  const dir = grokSessionDir(ref.path);
  const meta = await loadMeta(platform, dir, options);
  const main = await readJsonlRecords(platform, grokUpdatesPath(ref.path), options);
  const subagents = await readSubagentMetas(platform, dir, options, meta.skipped);
  return { ...meta, main, subagents };
}

async function loadGrok(
  platform: SessionPlatform,
  ref: SessionRef,
  options: LoadOptions = {}
): Promise<Result<Transcript, SessionReadError>> {
  const progress = readProgress(options.onProgress);
  const files = await catchIoFailure(platform, ref.path, options.signal, (guarded) =>
    readSession(guarded, ref, options.signal, progress)
  );
  if (!files.ok) {
    return files;
  }
  const { meta, skipped, generation, main, subagents } = files.value;
  if (generation) {
    return err(generation);
  }
  const translated = translateGrokRecords(main.records, {
    ...(ref.sessionId === undefined ? {} : { sessionId: ref.sessionId }),
    meta,
    subagents
  });
  if (!translated.ok) {
    return translated;
  }
  const parsed = translated.value;
  parsed.skipped.push(...skipped, ...main.skipped);
  options.signal?.throwIfAborted();
  return ok(createTranscript(AGENT, grokCapabilities(parsed.session, parsed.agents), parsed));
}

/**
 * Adds what `summary.json` says. A summary larger than the listing budget, or one this adapter cannot parse, leaves
 * the head as the preview built it; load reports the parse error.
 */
async function decorateGrokHead(
  platform: SessionPlatform,
  path: string,
  head: SessionHead,
  signal: AbortSignal | undefined
): Promise<void> {
  const summaryPath = grokSummaryPath(grokSessionDir(path));
  const read = await catchIoFailure(platform, summaryPath, signal, async (guarded) => {
    const info = await guarded.fs.stat(summaryPath, { followSymlinks: true });
    if (info?.kind !== "file" || info.size > EDGE_BYTES) {
      return undefined;
    }
    return { text: await readText(guarded, summaryPath, { signal }), size: info.size };
  });
  // A missing or unreadable summary leaves the preview head. Parse failures do the same; load reports them.
  // Cancellation is not one of those failures: listing must reject with the caller's reason.
  if (signal?.aborted) {
    throw signal.reason;
  }
  if (!read.ok || read.value === undefined) {
    return;
  }
  let value: unknown;
  try {
    value = JSON.parse(read.value.text) as unknown;
  } catch {
    if (signal?.aborted) {
      throw signal.reason;
    }
    return;
  }
  const parsed = grokSummaryFields(value, {
    file: summaryPath,
    offset: 0,
    length: read.value.size,
    line: 1
  });
  if (!parsed.ok) {
    return;
  }
  applyGrokSummary(head, parsed.value);
}

async function detectGrok(platform: SessionPlatform, ref: SessionRef): Promise<boolean> {
  const dir = grokSessionDir(ref.path);
  // A missing file is not this agent's session. An IO error must reach the caller's `catchIoFailure`.
  const summary = await platform.fs.stat(grokSummaryPath(dir), { followSymlinks: true });
  const updates = await platform.fs.stat(grokUpdatesPath(ref.path), { followSymlinks: true });
  return summary?.kind === "file" && updates?.kind === "file";
}

/**
 * The unknown-generation error `summary.json` reports, or `undefined` when the summary is missing, is not JSON
 * (the load path records an `invalid-json` skip, which no summary number reads), or names a generation this
 * adapter reads. The check runs before the records stream, so a foreign generation fails the read up front.
 */
async function grokGenerationError(
  platform: SessionPlatform,
  dir: string,
  signal: AbortSignal | undefined
): Promise<UnknownFormatGeneration | undefined> {
  const summaryPath = grokSummaryPath(dir);
  if ((await platform.fs.stat(summaryPath, { followSymlinks: true }))?.kind !== "file") {
    return undefined;
  }
  const text = await readText(platform, summaryPath, { signal, progress: readProgress(undefined) });
  const value = parseJson(text);
  if (value === undefined) {
    return undefined;
  }
  const parsed = grokSummaryFields(value, textSource(summaryPath, text));
  return parsed.ok ? undefined : parsed.error;
}

/** The `updates.jsonl` records, stamped with their inherited times, one at a time; a read stops when the loop leaves. */
function timedLines(
  platform: SessionPlatform,
  file: string,
  signal: AbortSignal | undefined
): AsyncGenerator<StampedRecord, void, undefined> {
  return mergeByTimeStream([
    (async function* () {
      for await (const record of readJsonlStream(platform, file, { signal })) {
        yield timedRecord(record);
      }
    })()
  ]);
}

/**
 * The summary in one bounded pass over the records, with the result `foldTranscript(load(...))` gives. Unlike
 * `loadGrok` it holds no records: `summary.json` is read for the generation check alone, the subagent metas for
 * the lane count, and the updates stream through `mergeByTimeStream` into the pass.
 */
async function summarizeGrok(
  platform: SessionPlatform,
  ref: SessionRef,
  signal: AbortSignal | undefined,
  prompts: SessionPromptsOptions | undefined
): Promise<Result<SessionSummaryWithPrompts, SessionReadError>> {
  const read = await catchIoFailure(platform, ref.path, signal, async (guarded) => {
    signal?.throwIfAborted();
    const dir = grokSessionDir(ref.path);
    const generation = await grokGenerationError(guarded, dir, signal);
    if (generation) {
      return err(generation);
    }
    const subagents = await readSubagentMetas(guarded, dir, { signal, progress: readProgress(undefined) }, []);
    const summarized = await summarizeGrokRecords(timedLines(guarded, grokUpdatesPath(ref.path), signal), {
      subagents,
      ...(prompts === undefined ? {} : { prompts })
    });
    signal?.throwIfAborted();
    return summarized;
  });
  if (!read.ok) {
    return read;
  }
  return read.value;
}

export const grokSessionAdapter: SessionAdapter = {
  specificationVersion: "sessions-v1",
  agent: AGENT,
  displayName: "Grok",
  capabilities: GROK_CAPABILITIES,
  roots: grokRoots,
  discover(platform, root, options = {}) {
    return discoverSessions(platform, AGENT, root, {
      ...options,
      files: GROK_SESSION_FILES,
      preview: previewGrokRecords,
      decorate: (filePlatform, path, head) => decorateGrokHead(filePlatform, path, head, options.signal)
    });
  },
  detect: detectGrok,
  load: loadGrok,
  summarize: (platform, ref, options = {}) => summarizeGrok(platform, ref, options.signal, options.prompts)
};

interface GrokSessionFiles {
  meta: GrokSessionMeta;
  skipped: SkippedRecord[];
  /** Set when `summary.json` names a generation this adapter does not read. */
  generation?: UnknownFormatGeneration;
  main: JsonlRecords;
  subagents: Map<string, GrokSubagentMeta>;
}
