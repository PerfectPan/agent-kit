import { KIMI_DISPLAY_NAME, KIMI_HOME, KIMI_ID, KIMI_SESSION_STATE_FILE } from "./facts.js";
import { definedFields, err, ok, type Result } from "@rivus/agent-kit-catalog/spi";
import {
  catchIoFailure,
  createTranscript,
  EDGE_BYTES,
  type JsonlRecords,
  type LoadOptions,
  readEdges,
  edgeRecords,
  readJsonlRecords,
  readProgress,
  readText,
  readJsonlStream,
  type SessionAdapter,
  type SessionHead,
  type SessionPlatform,
  type SessionReadError,
  type SessionRef,
  type Capability,
  type Transcript,
  sessionHead
} from "@rivus/agent-kit-sessions/spi";
import * as z from "zod/mini";
import { lenient } from "@rivus/agent-kit-sessions/spi";
import { kimiRoots } from "./layout.js";
import { previewKimiRecords } from "./sessions/preview.js";
import { KIMI_CAPABILITIES, createKimiTranslation } from "./sessions/events.js";
import { summarizeKimiRecords } from "./sessions/summarize.js";

// The `sessions/<workDirKey>/<sessionId>/` directory of Kimi Code 2.6.0: `state.json` beside `agents/main/wire.jsonl`,
// the main lane's event stream this adapter reads. Subagent lanes (`agents/<id>/wire.jsonl`) are not sessions of
// their own, so the walk only follows `agents/main`; the shared file walker cannot express that, so listing reads
// the directory tree here.

const KimiState = z.looseObject({
  id: z.string(),
  cwd: lenient(z.optional(z.string())),
  createdAt: lenient(z.optional(z.number())),
  updatedAt: lenient(z.optional(z.number())),
  title: lenient(z.optional(z.string()))
});

type KimiStateValue = z.output<typeof KimiState>;

function parseState(text: string): KimiStateValue | undefined {
  try {
    return z.safeParse(KimiState, JSON.parse(text) as unknown).data;
  } catch {
    return undefined;
  }
}

/** Reads `state.json` when it is small enough for the listing budget; a missing or unreadable one is optional. */
async function readState(
  platform: SessionPlatform,
  sessionDir: string,
  signal: AbortSignal | undefined
): Promise<KimiStateValue | undefined> {
  const path = `${sessionDir}/${KIMI_SESSION_STATE_FILE}`;
  const info = await platform.fs.stat(path, { followSymlinks: true });
  if (info?.kind !== "file" || info.size > EDGE_BYTES) {
    return undefined;
  }
  const text: string = await readText(platform, path, { signal });
  return parseState(text);
}

async function readKimiSession(
  platform: SessionPlatform,
  ref: SessionRef,
  signal: AbortSignal | undefined,
  onProgress: LoadOptions["onProgress"]
): Promise<Result<{ records: JsonlRecords; state: KimiStateValue | undefined }, SessionReadError>> {
  return catchIoFailure(platform, ref.path, signal, async (guarded) => {
    const records = await readJsonlRecords(guarded, ref.path, { signal, progress: readProgress(onProgress) });
    const sessionDir = ref.path.slice(0, ref.path.lastIndexOf("/agents/"));
    const state = await readState(guarded, sessionDir, signal);
    return { records, state };
  });
}

async function loadKimi(
  platform: SessionPlatform,
  ref: SessionRef,
  options: LoadOptions = {}
): Promise<Result<Transcript, SessionReadError>> {
  const files = await readKimiSession(platform, ref, options.signal, options.onProgress);
  if (!files.ok) {
    return files;
  }
  const { records, state } = files.value;
  const translation = createKimiTranslation({ retain: true });
  for (const record of records.records) {
    // The record's own `time` (epoch ms) is the wire's clock; a record without one inherits at the finish.
    const value = record.value as Record<string, unknown> | undefined;
    const time = typeof value?.["time"] === "number" ? (value["time"] as number) : 0;
    if (!translation.step(record, time).ok) {
      const generation = translation.generationError();
      return err(
        generation ?? { _tag: "UnknownFormatGeneration", agent: KIMI_ID, file: record.file, line: record.line }
      );
    }
  }
  const parsed = translation.finish(
    definedFields({
      id: state?.id ?? ref.sessionId ?? "unknown",
      ...(state?.title !== undefined ? { title: state.title } : {}),
      ...(state?.cwd !== undefined ? { cwd: state.cwd } : {})
    }),
    []
  );
  options.signal?.throwIfAborted();
  return ok(createTranscript(KIMI_ID, KIMI_CAPABILITIES, parsed));
}

export const kimiSessionAdapter: SessionAdapter = {
  specificationVersion: "sessions-v1",
  agent: KIMI_ID,
  displayName: KIMI_DISPLAY_NAME,
  capabilities: KIMI_CAPABILITIES,
  home: KIMI_HOME,
  roots: kimiRoots,
  async *discover(platform, root, options = {}) {
    const { signal } = options;
    if ((await platform.fs.stat(root, { followSymlinks: true })) === undefined) {
      yield { ref: { agent: KIMI_ID, path: root }, error: { _tag: "RootMissing", path: root } as const };
      return;
    }
    // `sessions/<workDirKey>/<sessionId>/agents/main/wire.jsonl` is the main lane of one session.
    const workDirs = await platform.fs.list(root).catch(() => []);
    for (const work of workDirs) {
      signal?.throwIfAborted();
      if (work.kind !== "dir") {
        continue;
      }
      const sessions = await platform.fs.list(`${root}/${work.name}`).catch(() => []);
      for (const session of sessions) {
        signal?.throwIfAborted();
        if (session.kind !== "dir") {
          continue;
        }
        const sessionDir = `${root}/${work.name}/${session.name}`;
        const wirePath = `${sessionDir}/agents/main/wire.jsonl`;
        const edges = await readEdges(platform, wirePath, definedFields({ signal }));
        if (!edges) {
          continue;
        }
        const state = await readState(platform, sessionDir, signal);
        const preview = previewKimiRecords(edgeRecords(edges), wirePath);
        const head = sessionHead(
          definedFields({ agent: KIMI_ID, path: wirePath, sessionId: state?.id ?? session.name }),
          definedFields({
            ...preview,
            ...(state?.cwd !== undefined ? { cwd: state.cwd } : {}),
            ...(state?.createdAt !== undefined && preview.startedAt === undefined
              ? { startedAt: state.createdAt }
              : {}),
            ...(state?.updatedAt !== undefined ? { lastAt: state.updatedAt } : {}),
            ...(state?.title !== undefined ? { title: state.title } : {})
          }),
          { sizeBytes: edges.size, mtimeMs: edges.mtimeMs }
        );
        yield head;
      }
    }
  },
  async detect(platform, ref) {
    const info = await platform.fs.stat(ref.path, { followSymlinks: true });
    return info?.kind === "file" && ref.path.endsWith("/agents/main/wire.jsonl");
  },
  load: loadKimi,
  summarize: (platform, ref, options = {}) =>
    catchIoFailure(platform, ref.path, options.signal, (guarded) =>
      summarizeKimiRecords(
        readJsonlStream(guarded, ref.path, definedFields({ signal: options.signal })),
        options.prompts
      )
    ).then((outcome) => (outcome.ok ? outcome.value : err(outcome.error as SessionReadError)))
};

export type { Capability, SessionHead };
