import { type Result, err, ok } from "@rivus/agent-kit-catalog/spi";
import {
  type Capability,
  type LoadOptions,
  MAIN_LANE_ID,
  type ParsedTranscript,
  type ReadFailed,
  SESSION_TITLE_MAX,
  type SessionAdapter,
  type SessionHead,
  type SessionListFailure,
  type SessionNotFound,
  type SessionPlatform,
  type SessionPromptsOptions,
  type SessionReadError,
  type SessionRef,
  type SessionSummaryWithPrompts,
  type SkippedRecord,
  type SourcePointer,
  type Transcript,
  type TranscriptEvent,
  type TranscriptSession,
  addRequest,
  assignSeq,
  baseEvent,
  createTranscript,
  emptyPrompts,
  emptyTotals,
  finishPass,
  joinPath,
  markOrphanToolResults,
  requestUsage
} from "@rivus/agent-kit-sessions/spi";

import { ZCODE_ID } from "./facts.js";
import { zcodeDatabaseBelowHome } from "./layout.js";
import { type ZcodeMessageValue, zcodeMessageOf, zcodePartOf } from "./sessions/records.js";
import { zcodeUsage } from "./usage.js";

/** Everything a ZCode session can show. */
export const ZCODE_CAPABILITIES: readonly Capability[] = ["requests", "usage", "reasoning"];

interface SessionRow {
  rowid: number;
  id: string;
  title: string;
  directory: string;
  time_created: number;
  time_updated: number;
  version: string;
}

interface MessageRow {
  rowid: number;
  id: string;
  time_created: number;
  data: string;
}

interface PartRow {
  rowid: number;
  id: string;
  message_id: string;
  time_created: number;
  data: string;
}

interface SessionRows {
  session: SessionRow;
  messages: MessageRow[];
  parts: PartRow[];
}

type Database = ReturnType<NonNullable<SessionPlatform["sqlite"]>["open"]>;

function number(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  return 0;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readFailed(path: string, message: string, cause?: unknown): ReadFailed {
  return { _tag: "ReadFailed", path, message, ...(cause === undefined ? {} : { cause }) };
}

function source(
  file: string,
  table: "session" | "message" | "part",
  column: string,
  rowid: number,
  line: number
): SourcePointer {
  return { file, offset: 0, length: 0, line, sqlite: { table, column, rowid } };
}

function openDatabase(platform: SessionPlatform, path: string): Result<Database, ReadFailed> {
  const sqlite = platform.sqlite;
  if (sqlite === undefined) {
    return err(readFailed(path, "SQLite is not available on this platform"));
  }
  try {
    return ok(sqlite.open(path, { readonly: true }));
  } catch (error) {
    return err(readFailed(path, error instanceof Error ? error.message : String(error), error));
  }
}

function readRows(
  database: Database,
  path: string,
  sessionId: string
): Result<SessionRows, SessionNotFound | ReadFailed> {
  try {
    // A soft-deleted session (`time_deleted` set) is gone for the app and stays gone here.
    const session = database
      .prepare(
        `SELECT rowid, id, title, directory, time_created, time_updated, version FROM session WHERE id = ? AND time_deleted IS NULL`
      )
      .get(sessionId);
    if (session === undefined) {
      return err({ _tag: "SessionNotFound", path });
    }
    // `sequence` is the app's per-session insertion order; the clock only backs it up.
    const messages = database
      .prepare(
        `SELECT rowid, id, time_created, data FROM message WHERE session_id = ? ORDER BY sequence, time_created, id`
      )
      .all(sessionId);
    const parts = database
      .prepare(
        `SELECT rowid, id, message_id, time_created, data FROM part WHERE session_id = ? ORDER BY time_created, id`
      )
      .all(sessionId);
    return ok({
      session: {
        rowid: number(session.rowid),
        id: text(session.id),
        title: text(session.title),
        directory: text(session.directory),
        time_created: number(session.time_created),
        time_updated: number(session.time_updated),
        version: text(session.version)
      },
      messages: messages.map((row: Record<string, unknown>) => ({
        rowid: number(row.rowid),
        id: text(row.id),
        time_created: number(row.time_created),
        data: text(row.data)
      })),
      parts: parts.map((row: Record<string, unknown>) => ({
        rowid: number(row.rowid),
        id: text(row.id),
        message_id: text(row.message_id),
        time_created: number(row.time_created),
        data: text(row.data)
      }))
    });
  } catch (error) {
    return err(readFailed(path, error instanceof Error ? error.message : String(error), error));
  }
}

function headOf(path: string, row: SessionRow, file: { size: number; mtimeMs: number }): SessionHead {
  return {
    ref: { agent: ZCODE_ID, path, sessionId: row.id },
    lastActiveAt: row.time_updated || row.time_created || file.mtimeMs,
    sizeBytes: file.size,
    ...(row.title === "" ? {} : { title: row.title.slice(0, SESSION_TITLE_MAX) }),
    ...(row.directory === "" ? {} : { cwd: row.directory }),
    ...(row.time_created === 0 ? {} : { startedAt: row.time_created })
  };
}

function modelOf(message: ZcodeMessageValue): string | undefined {
  return message.modelId ?? message.modelID ?? undefined;
}

function translate(rows: SessionRows, dbPath: string): Transcript {
  const events: TranscriptEvent[] = [];
  const skipped: SkippedRecord[] = [];
  const partsByMessage = new Map<string, PartRow[]>();
  for (const part of rows.parts) {
    const list = partsByMessage.get(part.message_id);
    if (list === undefined) {
      partsByMessage.set(part.message_id, [part]);
    } else {
      list.push(part);
    }
  }

  function skip(pointer: SourcePointer, reason: string): void {
    skipped.push({ reason, source: pointer });
  }

  skipped.push({ reason: "session-header", source: source(dbPath, "session", "title", rows.session.rowid, 1) });
  let line = 2;

  for (const messageRow of rows.messages) {
    const messageSource = source(dbPath, "message", "data", messageRow.rowid, line++);
    const parts = partsByMessage.get(messageRow.id) ?? [];
    partsByMessage.delete(messageRow.id);
    let messageValue: unknown;
    try {
      messageValue = JSON.parse(messageRow.data) as unknown;
    } catch {
      skip(messageSource, "invalid-json");
      continue;
    }
    const message = zcodeMessageOf(messageValue);
    if (message === undefined) {
      skip(messageSource, "invalid-message");
      continue;
    }
    const created = message.time?.created ?? messageRow.time_created;

    if (message.role === "user") {
      skip(messageSource, "user-message-envelope");
      for (const partRow of parts) {
        const partSource = source(dbPath, "part", "data", partRow.rowid, line++);
        let partValue: unknown;
        try {
          partValue = JSON.parse(partRow.data) as unknown;
        } catch {
          skip(partSource, "invalid-json");
          continue;
        }
        const part = zcodePartOf(partValue);
        if (part?.type === "text" && part.text) {
          events.push(baseEvent({ ...partSource, value: partValue }, "user", { text: part.text }, { ts: created }));
        } else {
          skip(partSource, `part:${part?.type ?? "unreadable"}`);
        }
      }
      continue;
    }

    if (message.role !== "assistant") {
      skip(messageSource, `message-role:${message.role}`);
      continue;
    }

    const requestKey = `request:${messageRow.id}`;
    const usage = zcodeUsage(message.tokens);
    events.push(
      baseEvent(
        { ...messageSource, value: messageValue },
        "request",
        {
          granularity: "request",
          ...(modelOf(message) === undefined ? {} : { model: modelOf(message) }),
          responseId: messageRow.id,
          ...(message.finish === undefined ? {} : { finishReason: message.finish }),
          ...(usage === undefined ? {} : { usage })
        },
        { id: messageRow.id, ts: created, requestId: requestKey }
      )
    );

    for (const partRow of parts) {
      const partSource = source(dbPath, "part", "data", partRow.rowid, line++);
      let partValue: unknown;
      try {
        partValue = JSON.parse(partRow.data) as unknown;
      } catch {
        skip(partSource, "invalid-json");
        continue;
      }
      const part = zcodePartOf(partValue);
      if (part === undefined) {
        skip(partSource, "invalid-part");
        continue;
      }
      const ts = part.time?.start ?? partRow.time_created;
      if (part.type === "text") {
        events.push(
          baseEvent(
            { ...partSource, value: partValue },
            "assistant",
            { text: part.text ?? "" },
            { ts, requestId: requestKey }
          )
        );
      } else if (part.type === "reasoning") {
        events.push(
          baseEvent(
            { ...partSource, value: partValue },
            "reasoning",
            { text: part.text ?? "" },
            { ts, requestId: requestKey }
          )
        );
      } else if (part.type === "tool") {
        const callId = part.callID ?? partRow.id;
        const state = part.state;
        events.push(
          baseEvent(
            { ...partSource, value: partValue },
            "tool_call",
            {
              callId,
              name: part.tool ?? "tool",
              ...(state?.input === undefined ? {} : { args: state.input })
            },
            { id: partRow.id, ts, requestId: requestKey }
          )
        );
        if (state?.status === "completed" || state?.status === "error") {
          events.push(
            baseEvent(
              { ...partSource, value: partValue },
              "tool_result",
              {
                callId,
                ...(state.output === undefined ? {} : { output: state.output }),
                ...(state.status === "error" || state.error !== undefined ? { isError: true } : {})
              },
              { id: `${partRow.id}:result`, ts: state.time?.end ?? ts, requestId: requestKey }
            )
          );
        }
      } else {
        skip(partSource, `part:${part.type}`);
      }
    }
  }

  // A part no message consumed — its message row is missing, or the row was skipped before its parts (invalid
  // JSON, an unknown shape, a role nothing translates) — is a skipped record, not a silent drop, so the record
  // accounting sees every input row.
  for (const parts of partsByMessage.values()) {
    for (const partRow of parts) {
      skip(source(dbPath, "part", "data", partRow.rowid, line++), "orphaned-part");
    }
  }

  markOrphanToolResults(events);
  assignSeq(events);
  const session: TranscriptSession = {
    id: rows.session.id,
    ...(rows.session.title === "" ? {} : { title: rows.session.title }),
    ...(rows.session.directory === "" ? {} : { cwd: rows.session.directory }),
    ...(rows.session.time_created === 0 ? {} : { startedAt: rows.session.time_created }),
    ...(rows.session.time_updated === 0 ? {} : { endedAt: rows.session.time_updated })
  };
  const capabilities: Capability[] = [];
  if (events.some((event) => event.kind === "request")) {
    capabilities.push("requests");
  }
  if (events.some((event) => event.kind === "request" && event.payload.usage !== undefined)) {
    capabilities.push("usage");
  }
  if (events.some((event) => event.kind === "reasoning")) {
    capabilities.push("reasoning");
  }
  const parsed: ParsedTranscript = {
    events,
    skipped,
    session,
    ...(rows.session.version === "" ? {} : { agentVersion: rows.session.version }),
    agents: [{ id: MAIN_LANE_ID }]
  };
  return createTranscript(ZCODE_ID, capabilities, parsed);
}

function failure(path: string, error: ReadFailed): SessionListFailure {
  return { ref: { agent: ZCODE_ID, path }, error };
}

async function* discoverZcode(
  platform: SessionPlatform,
  root: string,
  options: { signal?: AbortSignal; onTotal?: (files: number) => void } = {}
): AsyncGenerator<SessionHead | SessionListFailure, void, undefined> {
  const path = joinPath(root, zcodeDatabaseBelowHome);
  let info;
  try {
    info = await platform.fs.stat(path, { followSymlinks: true });
  } catch (error) {
    options.signal?.throwIfAborted();
    yield failure(path, readFailed(path, String(error), error));
    return;
  }
  if (info?.kind !== "file") {
    yield { ref: { agent: ZCODE_ID, path: root }, error: { _tag: "RootMissing", path: root } };
    return;
  }
  const database = openDatabase(platform, path);
  if (!database.ok) {
    yield failure(path, database.error);
    return;
  }
  try {
    const rows = database.value
      .prepare(
        `SELECT rowid, id, title, directory, time_created, time_updated, version FROM session WHERE time_deleted IS NULL ORDER BY time_updated DESC`
      )
      .all();
    options.onTotal?.(rows.length);
    for (const row of rows as Record<string, unknown>[]) {
      yield headOf(
        path,
        {
          rowid: number(row.rowid),
          id: text(row.id),
          title: text(row.title),
          directory: text(row.directory),
          time_created: number(row.time_created),
          time_updated: number(row.time_updated),
          version: text(row.version)
        },
        info
      );
    }
  } catch (error) {
    options.signal?.throwIfAborted();
    yield failure(path, readFailed(path, String(error), error));
  } finally {
    database.value.close();
  }
}

async function loadZcode(
  platform: SessionPlatform,
  ref: SessionRef,
  options: LoadOptions = {}
): Promise<Result<Transcript, SessionReadError>> {
  if (ref.sessionId === undefined) {
    return err(readFailed(ref.path, "a ZCode session needs its session id"));
  }
  const database = openDatabase(platform, ref.path);
  if (!database.ok) {
    return database;
  }
  try {
    options.signal?.throwIfAborted();
    const rows = readRows(database.value, ref.path, ref.sessionId);
    if (!rows.ok) {
      return rows;
    }
    return ok(translate(rows.value, ref.path));
  } finally {
    database.value.close();
  }
}

/**
 * The summary of one ZCode session in a bounded pass: message rows stream one at a time — the message list carries
 * only ids and times, each message's `data` is fetched by rowid, and only that message's parts are loaded — so a
 * large database session never materializes the whole transcript, the way the opencode summary runs its bounded
 * translation.
 */
async function summarizeZcode(
  platform: SessionPlatform,
  ref: SessionRef,
  options: { signal?: AbortSignal; prompts?: SessionPromptsOptions } = {}
): Promise<Result<SessionSummaryWithPrompts, SessionReadError>> {
  if (ref.sessionId === undefined) {
    return err(readFailed(ref.path, "a ZCode session needs its session id"));
  }
  const database = openDatabase(platform, ref.path);
  if (!database.ok) {
    return database;
  }
  try {
    options.signal?.throwIfAborted();
    const session = database.value
      .prepare(`SELECT rowid FROM session WHERE id = ? AND time_deleted IS NULL`)
      .get(ref.sessionId);
    if (session === undefined) {
      return err({ _tag: "SessionNotFound", path: ref.path });
    }
    const totals = emptyTotals();
    const prompts = emptyPrompts(options.prompts);
    const seen = new Set<Capability>();
    const messageRows = database.value
      .prepare(`SELECT rowid, id FROM message WHERE session_id = ? ORDER BY sequence, time_created, id`)
      .all(ref.sessionId)
      .map((row) => ({ rowid: number(row.rowid), id: text(row.id) }));
    const messageData = database.value.prepare(`SELECT data FROM message WHERE rowid = ?`);
    const partsOf = database.value.prepare(
      `SELECT rowid, time_created, data FROM part WHERE session_id = ? AND message_id = ? ORDER BY time_created, id`
    );
    for (const row of messageRows) {
      options.signal?.throwIfAborted();
      const data = messageData.get(row.rowid)?.data;
      let messageValue: unknown;
      try {
        messageValue = JSON.parse(text(data)) as unknown;
      } catch {
        continue;
      }
      const message = zcodeMessageOf(messageValue);
      if (message === undefined) {
        continue;
      }
      if (message.role === "user") {
        for (const partRow of partsOf.all(ref.sessionId, row.id)) {
          let partValue: unknown;
          try {
            partValue = JSON.parse(text(partRow.data)) as unknown;
          } catch {
            continue;
          }
          const part = zcodePartOf(partValue);
          if (part?.type === "text" && part.text) {
            totals.turns += 1;
            prompts.add(part.text);
          }
        }
        continue;
      }
      if (message.role !== "assistant") {
        continue;
      }
      seen.add("requests");
      const usage = zcodeUsage(message.tokens);
      if (usage !== undefined) {
        seen.add("usage");
      }
      const payload: Parameters<typeof requestUsage>[0]["payload"] = usage === undefined ? {} : { usage };
      addRequest(totals, requestUsage({ payload }));
      for (const partRow of partsOf.all(ref.sessionId, row.id)) {
        let partValue: unknown;
        try {
          partValue = JSON.parse(text(partRow.data)) as unknown;
        } catch {
          continue;
        }
        const part = zcodePartOf(partValue);
        if (part?.type === "reasoning") {
          seen.add("reasoning");
        } else if (part?.type === "tool") {
          const state = part.state;
          if (
            (state?.status === "completed" || state?.status === "error") &&
            (state.status === "error" || state.error !== undefined)
          ) {
            totals.failedTools += 1;
          }
        }
      }
    }
    const capabilities = ZCODE_CAPABILITIES.filter((capability) => seen.has(capability));
    return ok(finishPass(totals, capabilities, 0, prompts.list));
  } catch (error) {
    return err(readFailed(ref.path, error instanceof Error ? error.message : String(error), error));
  } finally {
    database.value.close();
  }
}

async function detectZcode(platform: SessionPlatform, ref: SessionRef): Promise<boolean> {
  if (!ref.path.endsWith(".sqlite") || ref.sessionId === undefined) {
    return false;
  }
  const database = openDatabase(platform, ref.path);
  if (!database.ok) {
    return false;
  }
  try {
    return (
      database.value
        .prepare("SELECT 1 AS present FROM session WHERE id = ? AND time_deleted IS NULL")
        .get(ref.sessionId) !== undefined
    );
  } finally {
    database.value.close();
  }
}

/**
 * ZCode keeps every session in `<home>/cli/db/db.sqlite`: one `session` row, `message` rows in the app's
 * `sequence` order with the message as JSON in the `data` column, and `part` rows for each message's text,
 * reasoning, tool calls and step boundaries. A session id selects the rows; the database path is the ref's path
 * for every session in it. A soft-deleted session (`time_deleted` set) no longer exists.
 */
export const zcodeSessionAdapter: SessionAdapter = {
  specificationVersion: "sessions-v1",
  agent: ZCODE_ID,
  displayName: ZCODE_ID,
  capabilities: ZCODE_CAPABILITIES,
  roots: (home) => [home.path],
  discover: discoverZcode,
  detect: detectZcode,
  load: loadZcode,
  summarize: (platform, ref, options = {}) => summarizeZcode(platform, ref, options)
};
