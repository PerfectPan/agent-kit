import { definedFields, err, ok, type Result } from "@rivus/agent-kit-catalog/spi";
import {
  assignSeq,
  catchSessionRead,
  createTranscript,
  joinPath,
  openDatabase,
  SESSION_TITLE_MAX,
  thrown,
  type Lane,
  type LoadOptions,
  type SessionAdapter,
  type SessionPlatform,
  type SessionReadError,
  type SkippedRecord,
  type SqliteDatabase,
  type Transcript,
  type TranscriptEvent,
  type TranscriptSession
} from "@rivus/agent-kit-sessions/spi";
import { DIM_DATABASE, DIM_DISPLAY_NAME, DIM_HOME, DIM_ID } from "./facts.js";
import { DIM_SESSION_CAPABILITIES, dimCapabilities } from "./sessions/capabilities.js";
import { translateDimLane, type DimLaneEvents } from "./sessions/events.js";
import { dimHeadOf, dimTime, type DimSessionRowValue } from "./sessions/rows.js";
import { dimForkFilter, dimLaneRows, dimSessionRow, dimSessionRows, dimSubagentRelations } from "./sessions/store.js";
import {
  createDimSubagentQueue,
  dimSubagentLane,
  dimTopLevelSessions,
  dimUnavailableLane,
  type DimChildLane
} from "./sessions/subagents.js";
import { summarizeDimSession } from "./sessions/summarize.js";

// The v2 SQLite database holds DimCode's sessions: `sessions` names each one (id, cwd, title, status, timestamps), and
// `messages` keeps one row per message with an AI-SDK-shaped `parts` JSON in `orderKey` order: `text` parts are the
// user's and the assistant's messages, the assistant's `thinking` parts its reasoning and its `tool_use` parts the
// tool calls, and a `tool_result` row carries each call's result. `usage_ledger` settles one usage event per row and
// `usage_run_stats` keeps each run's duration. `compaction_states` records each compaction a session applied, and
// `session_relations` each subagent a session spawned, which is a session of its own. Captured on 0.5.27.

/** Opens the session database read-only and closes it after `read`, mapping I/O and missing-file errors. */
function withDimDatabase<T>(
  platform: SessionPlatform,
  path: string,
  signal: AbortSignal | undefined,
  read: (database: SqliteDatabase) => Result<T, SessionReadError>
): Promise<Result<T, SessionReadError>> {
  return catchSessionRead(platform, path, signal, async (guarded) => {
    const info = await guarded.fs.stat(path, { followSymlinks: true });
    const opened =
      info?.kind === "file" ? openDatabase(guarded, path) : err({ _tag: "SessionNotFound" as const, path });
    if (!opened.ok) {
      return opened;
    }
    const database = opened.value;
    try {
      return read(database);
    } finally {
      database.close();
    }
  });
}

/** The transcript's session: the `sessions` row, with an empty title and unparsable times left out. */
function dimTranscriptSession(session: DimSessionRowValue): TranscriptSession {
  const startedAt = dimTime(session.createdAt);
  const endedAt = dimTime(session.updatedAt);
  return definedFields({
    id: session.sessionId,
    title: session.title !== undefined && session.title !== "" ? session.title.slice(0, SESSION_TITLE_MAX) : undefined,
    cwd: session.cwd !== "" ? session.cwd : undefined,
    startedAt: startedAt > 0 ? startedAt : undefined,
    endedAt: endedAt > 0 ? endedAt : undefined
  });
}

/** One subagent's events under its session id; neither when the store no longer has the session. */
function translateDimChild(database: SqliteDatabase, dbPath: string, child: DimChildLane): DimLaneEvents | undefined {
  const row = dimSessionRow(database, child.sessionId);
  if (row === undefined) {
    return undefined;
  }
  const forkFilter =
    child.forkContext === "all"
      ? dimForkFilter(database, child.sourceSessionId, row.createdAt, child.createdAt)
      : undefined;
  return translateDimLane(dbPath, dimLaneRows(database, child.sessionId, forkFilter), child.sessionId);
}

export const dimSessionAdapter: SessionAdapter = {
  specificationVersion: "sessions-v1",
  agent: DIM_ID,
  displayName: DIM_DISPLAY_NAME,
  capabilities: DIM_SESSION_CAPABILITIES,
  home: DIM_HOME,
  roots: (home) => [home.path],
  async *discover(platform, root, options = {}) {
    const { signal } = options;
    const path = joinPath(root, DIM_DATABASE);
    let info;
    try {
      info = await platform.fs.stat(path, { followSymlinks: true });
    } catch (error) {
      signal?.throwIfAborted();
      yield {
        ref: { agent: DIM_ID, path },
        error: thrown(path, error)
      };
      return;
    }
    if (info?.kind !== "file") {
      yield { ref: { agent: DIM_ID, path: root }, error: { _tag: "RootMissing", path: root } as const };
      return;
    }
    const opened = openDatabase(platform, path);
    if (!opened.ok) {
      yield { ref: { agent: DIM_ID, path }, error: opened.error };
      return;
    }
    const database = opened.value;
    try {
      const rows = dimSessionRows(database);
      // A subagent's session is a lane of its parent's transcript, not a session of its own.
      const topLevel = dimTopLevelSessions(
        rows.map((row) => row.sessionId),
        dimSubagentRelations(database)
      );
      for (const row of rows) {
        signal?.throwIfAborted();
        if (topLevel.has(row.sessionId)) {
          yield dimHeadOf(path, row, info.size, info.mtimeMs);
        }
      }
    } catch (error) {
      signal?.throwIfAborted();
      yield {
        ref: { agent: DIM_ID, path },
        error: thrown(path, error)
      };
    } finally {
      database.close();
    }
  },
  async detect(platform, ref) {
    const info = await platform.fs.stat(ref.path, { followSymlinks: true });
    return info?.kind === "file" && ref.path.replaceAll("\\", "/").endsWith(`/${DIM_DATABASE}`);
  },
  load(platform, ref, options: LoadOptions = {}): Promise<Result<Transcript, SessionReadError>> {
    return withDimDatabase(platform, ref.path, options.signal, (database) => {
      const sessionId = ref.sessionId ?? "";
      const session = dimSessionRow(database, sessionId);
      if (session === undefined) {
        return err({ _tag: "SessionNotFound", path: ref.path });
      }
      const root = translateDimLane(ref.path, dimLaneRows(database, sessionId));
      const lanes: Lane[] = [{ id: DIM_ID }];
      const laneEvents: TranscriptEvent[][] = [root.events];
      const skipped: SkippedRecord[] = [...root.skipped];
      const queue = createDimSubagentQueue(sessionId);
      queue.enqueue(dimSubagentRelations(database, sessionId), { laneId: DIM_ID, calls: root.calls });
      for (let child = queue.next(); child !== undefined; child = queue.next()) {
        options.signal?.throwIfAborted();
        // A subagent whose session row is gone is a lane without events, so the parent's record of it stays
        // visible; the parent's transcript still loads.
        const translated = translateDimChild(database, ref.path, child);
        if (translated === undefined) {
          lanes.push(dimUnavailableLane(child));
          continue;
        }
        laneEvents.push(translated.events);
        skipped.push(...translated.skipped);
        lanes.push(dimSubagentLane(child));
        queue.enqueue(dimSubagentRelations(database, child.sessionId), {
          laneId: child.sessionId,
          calls: translated.calls
        });
      }
      // The lanes join in pass order — the session first, then each subagent's — the order the summarize pass folds;
      // each lane's own event order, inherited times and orphan flags are final from its translation.
      const events = laneEvents.flat();
      assignSeq(events);
      return ok(
        createTranscript(DIM_ID, dimCapabilities(events, lanes.length - 1), {
          events,
          skipped,
          session: dimTranscriptSession(session),
          agents: lanes
        })
      );
    });
  },
  summarize: (platform, ref, options = {}) =>
    withDimDatabase(platform, ref.path, options.signal, (database) => {
      const sessionId = ref.sessionId ?? "";
      if (dimSessionRow(database, sessionId) === undefined) {
        return err({ _tag: "SessionNotFound", path: ref.path });
      }
      return ok(summarizeDimSession(database, sessionId, options.prompts, options.signal));
    })
};
