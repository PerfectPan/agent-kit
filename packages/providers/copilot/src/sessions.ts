import { definedFields, err, ok } from "@rivus/agent-kit-catalog/spi";
import {
  catchIoFailure,
  createTranscript,
  edgeRecords,
  readEdges,
  readSessionJsonl,
  sessionHead,
  type SessionAdapter,
  type SessionReadError,
  type SkippedRecord
} from "@rivus/agent-kit-sessions/spi";
import { COPILOT_DISPLAY_NAME, COPILOT_EVENTS_FILE, COPILOT_HOME, COPILOT_ID } from "./facts.js";
import { copilotRoots, copilotSessionIdFromPath } from "./layout.js";
import { COPILOT_CAPABILITIES, createCopilotTranslation } from "./sessions/events.js";
import { resolveCopilotJournalChain } from "./sessions/journal.js";
import { previewCopilotRecords } from "./sessions/preview.js";
import { summarizeCopilotSession } from "./sessions/summarize.js";

// GitHub Copilot CLI stores each session under `<home>/session-state/<session-id>/events.jsonl` (and optional rotated
// predecessor segments linked via `session.journal_link.data.previousFile`). Every event for the main lane and any
// subagent lanes lives in this journal; subagent events carry `agentId`.

export const copilotSessionAdapter: SessionAdapter = {
  specificationVersion: "sessions-v1",
  agent: COPILOT_ID,
  displayName: COPILOT_DISPLAY_NAME,
  capabilities: COPILOT_CAPABILITIES,
  home: COPILOT_HOME,
  roots: copilotRoots,
  async *discover(platform, root, options = {}) {
    const { signal } = options;
    signal?.throwIfAborted();
    if ((await platform.fs.stat(root, { followSymlinks: true })) === undefined) {
      yield { ref: { agent: COPILOT_ID, path: root }, error: { _tag: "RootMissing", path: root } as const };
      return;
    }
    const entries = await platform.fs.list(root).catch(() => []);
    signal?.throwIfAborted();
    for (const entry of entries) {
      signal?.throwIfAborted();
      if (entry.kind !== "dir" || entry.name.startsWith(".")) {
        continue;
      }
      const path = `${root}/${entry.name}/${COPILOT_EVENTS_FILE}`;
      const edges = await readEdges(platform, path, definedFields({ signal }));
      if (edges === undefined) {
        continue;
      }
      const ref = definedFields({ agent: COPILOT_ID, path, sessionId: entry.name });
      yield sessionHead(ref, previewCopilotRecords(edgeRecords(edges)), {
        sizeBytes: edges.size,
        mtimeMs: edges.mtimeMs
      });
    }
  },
  detect: async (platform, ref) =>
    copilotSessionIdFromPath(ref.path) !== undefined &&
    (await platform.fs.stat(ref.path, { followSymlinks: true }))?.kind === "file",
  load: async (platform, ref, options = {}) => {
    const chain = await resolveCopilotJournalChain(platform, ref.path, options.signal);
    const translation = createCopilotTranslation({ retain: true });
    const fileSkipped: SkippedRecord[] = [];
    for (const [index, segmentPath] of chain.entries()) {
      const read = await readSessionJsonl(platform, segmentPath, options);
      if (!read.ok) {
        if (segmentPath === ref.path) {
          return read;
        }
        continue;
      }
      fileSkipped.push(...read.value.skipped);
      const hasPrevious = index > 0;
      for (const record of read.value.records) {
        const stepped = translation.step(record, hasPrevious);
        if (!stepped.ok) {
          return err(stepped.error);
        }
      }
    }
    const parsed = translation.finish(ref.sessionId ?? copilotSessionIdFromPath(ref.path) ?? "unknown");
    parsed.skipped = [...fileSkipped, ...parsed.skipped];
    options.signal?.throwIfAborted();
    return ok(createTranscript(COPILOT_ID, translation.capabilities, parsed));
  },
  summarize: (platform, ref, options = {}) =>
    catchIoFailure(platform, ref.path, options.signal, (guarded) =>
      summarizeCopilotSession(guarded, ref.path, options.signal, options.prompts)
    ).then((outcome) => (outcome.ok ? outcome.value : err(outcome.error as SessionReadError)))
};
