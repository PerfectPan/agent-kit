import { CODEX_ID, CODEX_DISPLAY_NAME } from "./facts.js";
import { ok, type Result } from "@rivus/agent-kit-catalog/spi";
import { CODEX_SESSION_FILES, codexRoots, looksLikeCodexSession } from "./layout.js";
import { previewCodexRecords } from "./sessions/preview.js";
import { CODEX_CAPABILITIES, codexCapabilities, translateCodexRecords } from "./sessions/events.js";
import { summarizeCodexRecords } from "./sessions/summarize.js";
import {
  type SessionPromptsOptions,
  type SessionRef,
  type SessionSummaryWithPrompts,
  createTranscript,
  mergeByTime,
  type TimedRecord,
  type Transcript,
  timedRecord,
  discoverSessions,
  readEdges,
  catchIoFailure,
  readJsonlRecords,
  readJsonlStream,
  readProgress,
  type LoadOptions,
  type SessionAdapter,
  type SessionPlatform,
  type SessionReadError
} from "@rivus/agent-kit-sessions/spi";

const AGENT = CODEX_ID;

async function loadCodex(
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
  const translated = translateCodexRecords(mergeByTime([records.map(timedRecord)]), {
    ...(ref.sessionId === undefined ? {} : { sessionId: ref.sessionId }),
    path: ref.path
  });
  if (!translated.ok) {
    return translated;
  }
  const parsed = translated.value;
  parsed.skipped.push(...skipped);
  options.signal?.throwIfAborted();
  return ok(createTranscript(AGENT, codexCapabilities(parsed.session), parsed));
}

/** The rollout's records in file order with their own times, one at a time; a read stops when the loop leaves. */
function timedLines(
  platform: SessionPlatform,
  file: string,
  signal: AbortSignal | undefined
): AsyncGenerator<TimedRecord, void, undefined> {
  return (async function* () {
    for await (const record of readJsonlStream(platform, file, { signal })) {
      yield timedRecord(record);
    }
  })();
}

/**
 * The summary in one bounded pass over the records, with the result `foldTranscript(load(...))` gives. Unlike
 * `loadCodex` it holds no records: the fork replay's end is decided in a first streaming read, and the fold keeps
 * only the running numbers.
 */
async function summarizeCodex(
  platform: SessionPlatform,
  ref: SessionRef,
  signal: AbortSignal | undefined,
  prompts: SessionPromptsOptions | undefined
): Promise<Result<SessionSummaryWithPrompts, SessionReadError>> {
  const read = await catchIoFailure(platform, ref.path, signal, async (guarded) => {
    signal?.throwIfAborted();
    return summarizeCodexRecords(() => timedLines(guarded, ref.path, signal), prompts === undefined ? {} : { prompts });
  });
  if (!read.ok) {
    return read;
  }
  return read.value;
}

export const codexSessionAdapter: SessionAdapter = {
  specificationVersion: "sessions-v1",
  agent: AGENT,
  displayName: CODEX_DISPLAY_NAME,
  capabilities: CODEX_CAPABILITIES,
  roots: codexRoots,
  discover(platform, root, options = {}) {
    return discoverSessions(platform, AGENT, root, {
      ...options,
      files: CODEX_SESSION_FILES,
      preview: previewCodexRecords
    });
  },
  async detect(platform, ref) {
    if (looksLikeCodexSession(ref.path, undefined)) {
      return true;
    }
    // A head in another format is `false`; an IO error must reach the caller's `catchIoFailure`.
    return looksLikeCodexSession(ref.path, (await readEdges(platform, ref.path))?.head);
  },
  load: loadCodex,
  summarize: (platform, ref, options = {}) => summarizeCodex(platform, ref, options.signal, options.prompts)
};

export { CODEX_CAPABILITIES, translateCodexRecords, type CodexTranslateOptions } from "./sessions/events.js";
