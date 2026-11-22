import { KIMI_DISPLAY_NAME, KIMI_HOME, KIMI_ID, KIMI_SESSION_STATE_FILE } from "./facts.js";
import { definedFields, err, ok, type Result } from "@rivus/agent-kit-catalog/spi";
import {
  assignSeq,
  catchIoFailure,
  createTranscript,
  EDGE_BYTES,
  type JsonlRecords,
  type Lane,
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
  shadowBefore,
  type Capability,
  type Transcript,
  type TranscriptEvent,
  sessionHead
} from "@rivus/agent-kit-sessions/spi";
import * as z from "zod/mini";
import { lenient } from "@rivus/agent-kit-sessions/spi";
import { kimiRoots } from "./layout.js";
import { previewKimiRecords } from "./sessions/preview.js";
import { createKimiTranslation } from "./sessions/events.js";
import { KIMI_CAPABILITIES, kimiCapabilities } from "./sessions/capabilities.js";
import { summarizeKimiRecords } from "./sessions/summarize.js";

// The `sessions/<workDirKey>/<sessionId>/` directory of Kimi Code 2.6.0: `state.json` beside `agents/main/wire.jsonl`,
// the main lane's event stream this adapter reads. Each subagent keeps its own `agents/<id>/wire.jsonl` — a parent's
// log holds only the Agent tool call and the returned result — so loading joins them as lanes after the main lane's
// events. Subagent directories are not sessions of their own, so the walk only follows `agents/main`; the shared
// file walker cannot express that, so listing reads the directory tree here.

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

/**
 * Reads `state.json` when it is small enough for the listing budget. The file is metadata, not the session: a
 * missing, unreadable or unparseable one leaves the head and the transcript without its fields, and never fails the
 * wire file the session is. An aborted read still fails, so cancellation keeps working.
 */
async function readState(
  platform: SessionPlatform,
  sessionDir: string,
  signal: AbortSignal | undefined
): Promise<KimiStateValue | undefined> {
  const path = `${sessionDir}/${KIMI_SESSION_STATE_FILE}`;
  let info = undefined;
  try {
    info = await platform.fs.stat(path, { followSymlinks: true });
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
    return undefined;
  }
  if (info?.kind !== "file" || info.size > EDGE_BYTES) {
    return undefined;
  }
  let text: string;
  try {
    text = await readText(platform, path, { signal });
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
    return undefined;
  }
  return parseState(text);
}

async function readKimiSession(
  platform: SessionPlatform,
  ref: SessionRef,
  signal: AbortSignal | undefined,
  onProgress: LoadOptions["onProgress"]
): Promise<Result<{ records: JsonlRecords; state: KimiStateValue | undefined; sessionDir: string }, SessionReadError>> {
  return catchIoFailure(platform, ref.path, signal, async (guarded) => {
    const records = await readJsonlRecords(guarded, ref.path, { signal, progress: readProgress(onProgress) });
    const sessionDir = ref.path.slice(0, ref.path.lastIndexOf("/agents/"));
    const state = await readState(guarded, sessionDir, signal);
    return { records, state, sessionDir };
  });
}

/**
 * The subagent lanes of one session: `agents/<id>/wire.jsonl` beside the main wire, ids sorted so both passes join
 * the lanes in the same order. A directory without a readable wire is not a lane.
 */
async function subagentWirePaths(
  platform: SessionPlatform,
  sessionDir: string,
  signal: AbortSignal | undefined
): Promise<{ id: string; path: string }[]> {
  const agents = await platform.fs.list(`${sessionDir}/agents`).catch(() => []);
  signal?.throwIfAborted();
  return agents
    .filter((entry) => entry.kind === "dir" && entry.name !== "main")
    .map((entry) => entry.name)
    .sort()
    .map((id) => ({ id, path: `${sessionDir}/agents/${id}/wire.jsonl` }));
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
  const { records, state, sessionDir } = files.value;
  const translation = createKimiTranslation({ retain: true });
  const stepRecords = (
    run: { step(record: (typeof records.records)[number], ts: number): { ok: boolean } },
    wire: JsonlRecords
  ): boolean => {
    for (const record of wire.records) {
      // The record's own `time` (epoch ms) is the wire's clock; a record without one inherits at the finish.
      const value = record.value as Record<string, unknown> | undefined;
      const time = typeof value?.["time"] === "number" ? (value["time"] as number) : 0;
      if (!run.step(record, time).ok) {
        return false;
      }
    }
    return true;
  };
  if (!stepRecords(translation, records)) {
    const generation = translation.generationError();
    return err(generation ?? { _tag: "UnknownFormatGeneration", agent: KIMI_ID, file: ref.path, line: 0 });
  }

  // Subagent lanes join after the main lane's events, ids prefixed with the lane so the wires' shared `wire.jsonl`
  // basenames cannot collide. A subagent wire that fails to read or names an unknown protocol version is skipped:
  // the main wire decides the session's generation, and a partial transcript beats a failed one.
  const lanes: Lane[] = [{ id: KIMI_ID }];
  const laneEvents: TranscriptEvent[][] = [translation.events];
  const skipped = [...records.skipped];
  const spawnEvents = new Map(translation.spawns);
  for (const wire of await subagentWirePaths(platform, sessionDir, options.signal)) {
    options.signal?.throwIfAborted();
    const read = await catchIoFailure(platform, wire.path, options.signal, (guarded) =>
      readJsonlRecords(guarded, wire.path, { signal: options.signal })
    );
    if (!read.ok) {
      continue;
    }
    const subTranslation = createKimiTranslation({ retain: true });
    if (!stepRecords(subTranslation, read.value)) {
      continue;
    }
    const subParsed = subTranslation.finish({ id: wire.id }, []);
    const events = subParsed.events;
    for (const event of events) {
      event.id = `${wire.id}:${event.id}`;
      event.agentId = wire.id;
    }
    laneEvents.push(events);
    skipped.push(...read.value.skipped, ...subParsed.skipped);
    const spawnEventId = spawnEvents.get(wire.id);
    lanes.push(
      definedFields({
        id: wire.id,
        parentId: KIMI_ID,
        ...(spawnEventId !== undefined ? { spawnEventId } : {})
      })
    );
  }

  const parsed = translation.finish(
    definedFields({
      id: state?.id ?? ref.sessionId ?? "unknown",
      ...(state?.title !== undefined ? { title: state.title } : {}),
      ...(state?.cwd !== undefined ? { cwd: state.cwd } : {})
    }),
    lanes
  );
  // The lanes join in pass order — the main wire first, then each subagent's, the order the summarize pass folds —
  // and every lane's own event order and inherited times are already final from its translation's finish.
  const events = laneEvents.flat();
  // A compaction removes its lane's earlier events from the model's context: the summary replaced them.
  for (const event of events) {
    if (event.kind === "compaction") {
      shadowBefore(events, event);
    }
  }
  assignSeq(events);
  parsed.events = events;
  parsed.agents = lanes;
  // Lines that were never JSON never became records, so only this merge accounts for them; the translations' own
  // skips cover the records that produced no event. Both lists carry their records' source pointers.
  parsed.skipped = [...skipped, ...parsed.skipped];
  options.signal?.throwIfAborted();
  return ok(createTranscript(KIMI_ID, kimiCapabilities(parsed.session, events), parsed));
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
    catchIoFailure(platform, ref.path, options.signal, async (guarded) => {
      const sessionDir = ref.path.slice(0, ref.path.lastIndexOf("/agents/"));
      const wires = await subagentWirePaths(guarded, sessionDir, options.signal);
      return summarizeKimiRecords(
        {
          main: readJsonlStream(guarded, ref.path, definedFields({ signal: options.signal })),
          subagents: wires.map((wire) => readJsonlStream(guarded, wire.path, definedFields({ signal: options.signal })))
        },
        options.prompts
      );
    }).then((outcome) => (outcome.ok ? outcome.value : err(outcome.error as SessionReadError)))
};

export type { Capability, SessionHead };
