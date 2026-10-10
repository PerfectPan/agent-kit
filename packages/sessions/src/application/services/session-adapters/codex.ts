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
import type { SessionRef } from "../../../domain/session/index.js";
import { createTranscript, mergeByTime, type Transcript } from "../../../domain/transcript/index.js";
import { timedRecord } from "../../../domain/transcript/adapters/record-time.js";
import { discoverSessions } from "../discover-sessions.js";
import { readEdges } from "../files/edges.js";
import { catchIoFailure } from "../files/io-failure.js";
import { readJsonlRecords } from "../files/jsonl.js";
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
  load: loadCodex
};
