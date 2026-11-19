import { definedFields, err, ok, type Result } from "@rivus/agent-kit-catalog/spi";
import {
  catchIoFailure,
  createTranscript,
  edgeRecords,
  readEdges,
  readJsonlRecords,
  readJsonlStream,
  readProgress,
  sessionHead,
  type LoadOptions,
  type SessionAdapter,
  type SessionPlatform,
  type SessionReadError,
  type SessionRef,
  type Transcript
} from "@rivus/agent-kit-sessions/spi";
import { AGY_DISPLAY_NAME, AGY_HOME, AGY_ID, AGY_TRANSCRIPT_FULL_REL, AGY_TRANSCRIPT_REL } from "./facts.js";
import { agyRoots, agySessionIdFromPath } from "./layout.js";
import { AGY_CAPABILITIES, createAgyTranslation } from "./sessions/events.js";
import { previewAgyRecords } from "./sessions/preview.js";
import { summarizeAgyRecords } from "./sessions/summarize.js";

// Antigravity CLI writes per-conversation JSONL step logs under
// `<home>/antigravity-cli/brain/<conversation-id>/.system_generated/logs/`: `transcript_full.jsonl` keeps complete
// content and `transcript.jsonl` truncates long fields. Discovery prefers `transcript_full.jsonl` when present and
// falls back to `transcript.jsonl` so each conversation yields one session.

async function loadAgy(
  platform: SessionPlatform,
  ref: SessionRef,
  options: LoadOptions = {}
): Promise<Result<Transcript, SessionReadError>> {
  const file = await catchIoFailure(platform, ref.path, options.signal, (guarded) =>
    readJsonlRecords(guarded, ref.path, { signal: options.signal, progress: readProgress(options.onProgress) })
  );
  if (!file.ok) {
    return file;
  }
  const translation = createAgyTranslation({ retain: true });
  for (const record of file.value.records) {
    translation.step(record);
  }
  const parsed = translation.finish(definedFields({ id: ref.sessionId ?? agySessionIdFromPath(ref.path) }), [
    { id: AGY_ID }
  ]);
  parsed.skipped = [...file.value.skipped, ...parsed.skipped];
  options.signal?.throwIfAborted();
  return ok(createTranscript(AGY_ID, AGY_CAPABILITIES, parsed));
}

export const agySessionAdapter: SessionAdapter = {
  specificationVersion: "sessions-v1",
  agent: AGY_ID,
  displayName: AGY_DISPLAY_NAME,
  capabilities: AGY_CAPABILITIES,
  home: AGY_HOME,
  roots: agyRoots,
  async *discover(platform, root, options = {}) {
    const { signal } = options;
    if ((await platform.fs.stat(root, { followSymlinks: true })) === undefined) {
      yield { ref: { agent: AGY_ID, path: root }, error: { _tag: "RootMissing", path: root } as const };
      return;
    }
    const conversations = await platform.fs.list(root).catch(() => []);
    for (const entry of conversations) {
      signal?.throwIfAborted();
      if (entry.kind !== "dir") {
        continue;
      }
      const fullPath = `${root}/${entry.name}/${AGY_TRANSCRIPT_FULL_REL}`;
      const compactPath = `${root}/${entry.name}/${AGY_TRANSCRIPT_REL}`;
      const fullEdges = await readEdges(platform, fullPath, definedFields({ signal }));
      const path = fullEdges !== undefined ? fullPath : compactPath;
      const edges = fullEdges ?? (await readEdges(platform, compactPath, definedFields({ signal })));
      if (edges === undefined) {
        continue;
      }
      const preview = previewAgyRecords(edgeRecords(edges));
      yield sessionHead(definedFields({ agent: AGY_ID, path, sessionId: entry.name }), preview, {
        sizeBytes: edges.size,
        mtimeMs: edges.mtimeMs
      });
    }
  },
  async detect(platform, ref) {
    const info = await platform.fs.stat(ref.path, { followSymlinks: true });
    return (
      info?.kind === "file" &&
      (ref.path.endsWith(`/${AGY_TRANSCRIPT_FULL_REL}`) || ref.path.endsWith(`/${AGY_TRANSCRIPT_REL}`))
    );
  },
  load: loadAgy,
  summarize: (platform, ref, options = {}) =>
    catchIoFailure(platform, ref.path, options.signal, (guarded) =>
      summarizeAgyRecords(
        readJsonlStream(guarded, ref.path, definedFields({ signal: options.signal })),
        options.prompts
      )
    ).then((outcome) => (outcome.ok ? outcome.value : err(outcome.error as SessionReadError)))
};
