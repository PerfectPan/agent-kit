import { ok, type Result } from "@rivus/agent-kit-catalog";

import {
  CODEX_CAPABILITIES,
  CODEX_SESSION_FILES,
  codexCapabilities,
  codexRoots,
  codexSessionStem,
  looksLikeCodexSession,
  previewCodexRecords,
  translateCodexRecords
} from "../../../domain/adapters/codex/index.js";
import type { SessionRef } from "../../../domain/session/index.js";
import { createTranscript, mergeByTime, type Transcript } from "../../../domain/transcript/index.js";
import { discoverSessions } from "../../use-cases/discover-sessions.js";
import { readEdges } from "../files/edges.js";
import { catchIoFailure } from "../files/io-failure.js";
import { readJsonlRecords } from "../files/jsonl.js";
import { readProgress } from "../files/read-file.js";
import type { LoadOptions, SessionAdapter, SessionPlatform, SessionReadError } from "../../ports.js";

const AGENT = "codex";

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
  const translated = translateCodexRecords(
    mergeByTime([records]),
    ref.sessionId === undefined ? {} : { sessionId: ref.sessionId }
  );
  if (!translated.ok) {
    return translated;
  }
  const parsed = translated.value;
  parsed.skipped.push(...skipped);
  if (parsed.session.id === "unknown") {
    parsed.session.id = codexSessionStem(ref.path) || "unknown";
  }
  options.signal?.throwIfAborted();
  return ok(createTranscript(AGENT, codexCapabilities(parsed.session), parsed));
}
