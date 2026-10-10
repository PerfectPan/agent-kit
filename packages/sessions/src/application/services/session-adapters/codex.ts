import { ok, type Result } from "@rivus/agent-kit-catalog";

import {
  CODEX_SESSION_FILES,
  codexRoots,
  looksLikeCodexSession
} from "../../../domain/session/adapters/codex/layout.js";
import { previewCodexRecords } from "../../../domain/session/adapters/codex/preview.js";
import {
  CODEX_CAPABILITIES,
  codexCapabilities,
  translateCodexRecords
} from "../../../domain/transcript/adapters/codex/events.js";
import { summarizeCodexRecords } from "../../../domain/transcript/adapters/codex/summarize.js";
import type { SessionPromptsOptions, SessionRef, SessionSummaryWithPrompts } from "../../../domain/session/index.js";
import {
  createTranscript,
  mergeByTime,
  mergeByTimeStream,
  type StampedRecord,
  type Transcript
} from "../../../domain/transcript/index.js";
import { timedRecord } from "../../../domain/transcript/adapters/record-time.js";
import { discoverSessions } from "../discover-sessions.js";
import { readEdges } from "../files/edges.js";
import { catchIoFailure } from "../files/io-failure.js";
import { readJsonlRecords, readJsonlStream } from "../files/jsonl.js";
import { readProgress } from "../files/read-file.js";
import type { LoadOptions, SessionAdapter, SessionPlatform, SessionReadError } from "../../ports.js";

const AGENT = "codex";

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

/** The rollout's records, stamped with their inherited times, one at a time; a read stops when the loop leaves. */
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
  displayName: "Codex",
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
