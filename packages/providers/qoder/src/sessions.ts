import { definedFields, ok, type Result } from "@rivus/agent-kit-catalog/spi";
import {
  catchIoFailure,
  createTranscript,
  discoverSessions,
  readJsonlStream,
  readLines,
  readSessionJsonl,
  type LoadOptions,
  type SessionAdapter,
  type SessionPlatform,
  type SessionReadError,
  type SessionRef,
  type Transcript
} from "@rivus/agent-kit-sessions/spi";
import { QODER_DISPLAY_NAME, QODER_HOME, QODER_ID, QODER_SESSION_SUFFIX } from "./facts.js";
import { qoderIsMainSessionPath, qoderRoots, qoderUsageTarget } from "./layout.js";
import { qoderRecordOf } from "./records.js";
import { createQoderTranslation, QODER_CAPABILITIES } from "./sessions/events.js";
import { previewQoderRecords } from "./sessions/preview.js";
import { summarizeQoderRecords } from "./sessions/summarize.js";

// Qoder CLI stores per-project JSONL transcripts under `<home>/projects/<encoded-cwd>/<sessionId>.jsonl`
// (verified in qodercli 1.1.88).

const QODER_SESSION_FILES = {
  match: (name: string): boolean => name.endsWith(QODER_SESSION_SUFFIX) && name.length > QODER_SESSION_SUFFIX.length,
  maxDepth: 1
};

async function loadQoder(
  platform: SessionPlatform,
  ref: SessionRef,
  options: LoadOptions = {}
): Promise<Result<Transcript, SessionReadError>> {
  const file = await readSessionJsonl(platform, ref.path, options);
  if (!file.ok) {
    return file;
  }
  const translation = createQoderTranslation({ retain: true });
  for (const record of file.value.records) {
    translation.step(record);
  }
  const sessionId = ref.sessionId ?? qoderUsageTarget(ref.path)?.sessionId ?? "unknown";
  const parsed = translation.finish(definedFields({ id: sessionId }));
  parsed.skipped = [...file.value.skipped, ...parsed.skipped];
  options.signal?.throwIfAborted();
  return ok(createTranscript(QODER_ID, QODER_CAPABILITIES, parsed));
}

export const qoderSessionAdapter: SessionAdapter = {
  specificationVersion: "sessions-v1",
  agent: QODER_ID,
  displayName: QODER_DISPLAY_NAME,
  capabilities: QODER_CAPABILITIES,
  home: QODER_HOME,
  roots: qoderRoots,
  discover: (platform, root, options = {}) =>
    discoverSessions(platform, QODER_ID, root, {
      ...options,
      files: QODER_SESSION_FILES,
      preview: (records) => previewQoderRecords(records)
    }),
  async detect(platform, ref) {
    const info = await platform.fs.stat(ref.path, { followSymlinks: true });
    if (info?.kind !== "file" || !qoderIsMainSessionPath(ref.path)) {
      return false;
    }
    const normalized = ref.path.replaceAll("\\", "/");
    if (normalized.includes("/.claude/")) {
      return false;
    }
    try {
      for await (const line of readLines(platform, ref.path)) {
        const trimmed = line.text.trim();
        if (trimmed === "") {
          continue;
        }
        const parsed = qoderRecordOf(JSON.parse(trimmed) as unknown);
        return parsed !== undefined;
      }
      return false;
    } catch {
      return false;
    }
  },
  load: loadQoder,
  summarize: async (platform, ref, options = {}) => {
    const outcome = await catchIoFailure(platform, ref.path, options.signal, (guarded) =>
      summarizeQoderRecords(
        readJsonlStream(guarded, ref.path, definedFields({ signal: options.signal })),
        options.prompts
      )
    );
    options.signal?.throwIfAborted();
    return outcome.ok ? outcome.value : outcome;
  }
};
