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
  isPrompt,
  joinPath,
  markOrphanToolResults,
  requestUsage
} from "@rivus/agent-kit-sessions/spi";

import { OPENCODE_ID } from "./facts.js";
import { opencodeDatabaseFile } from "./layout.js";
import { opencodeMessageOf, opencodePartOf, opencodeUsageOf } from "./sessions/records.js";

/** Everything an OpenCode session can show. */
export const OPENCODE_CAPABILITIES: readonly Capability[] = ["requests", "usage", "reasoning"];

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
    const session = database
      .prepare(`SELECT rowid, id, title, directory, time_created, time_updated, version FROM session WHERE id = ?`)
      .get(sessionId);
    if (session === undefined) {
      return err({ _tag: "SessionNotFound", path });
    }
    const messages = database
      .prepare(`SELECT rowid, id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created, id`)
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
    ref: { agent: OPENCODE_ID, path, sessionId: row.id },
    lastActiveAt: row.time_updated || row.time_created || file.mtimeMs,
    sizeBytes: file.size,
    ...(row.title === "" ? {} : { title: row.title.slice(0, SESSION_TITLE_MAX) }),
    ...(row.directory === "" ? {} : { cwd: row.directory }),
    ...(row.time_created === 0 ? {} : { startedAt: row.time_created })
  };
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
    let messageValue: unknown;
    try {
      messageValue = JSON.parse(messageRow.data) as unknown;
    } catch {
      skip(messageSource, "invalid-json");
      continue;
    }
    const message = opencodeMessageOf(messageValue);
    if (message === undefined) {
      skip(messageSource, "invalid-message");
      continue;
    }
    const parts = partsByMessage.get(messageRow.id) ?? [];
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
        const part = opencodePartOf(partValue);
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
    const usage = opencodeUsageOf(message.tokens);
    events.push(
      baseEvent(
        { ...messageSource, value: messageValue },
        "request",
        {
          granularity: "request",
          ...(message.modelID === undefined ? {} : { model: message.modelID }),
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
      const part = opencodePartOf(partValue);
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
  return createTranscript(OPENCODE_ID, capabilities, parsed);
}

function failure(path: string, error: ReadFailed): SessionListFailure {
  return { ref: { agent: OPENCODE_ID, path }, error };
}

async function* discoverOpenCode(
  platform: SessionPlatform,
  root: string,
  options: { signal?: AbortSignal; onTotal?: (files: number) => void } = {}
): AsyncGenerator<SessionHead | SessionListFailure, void, undefined> {
  const path = joinPath(root, opencodeDatabaseFile);
  let info;
  try {
    info = await platform.fs.stat(path, { followSymlinks: true });
  } catch (error) {
    options.signal?.throwIfAborted();
    yield failure(path, readFailed(path, String(error), error));
    return;
  }
  if (info?.kind !== "file") {
    yield { ref: { agent: OPENCODE_ID, path: root }, error: { _tag: "RootMissing", path: root } };
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
        `SELECT rowid, id, title, directory, time_created, time_updated, version FROM session ORDER BY time_updated DESC`
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

async function loadOpenCode(
  platform: SessionPlatform,
  ref: SessionRef,
  options: LoadOptions = {}
): Promise<Result<Transcript, SessionReadError>> {
  if (ref.sessionId === undefined) {
    return err(readFailed(ref.path, "an OpenCode session needs its session id"));
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

async function summarizeOpenCode(
  platform: SessionPlatform,
  ref: SessionRef,
  options: { signal?: AbortSignal; prompts?: SessionPromptsOptions } = {}
): Promise<Result<SessionSummaryWithPrompts, SessionReadError>> {
  const loaded = await loadOpenCode(platform, ref, options);
  if (!loaded.ok) {
    return loaded;
  }
  const totals = emptyTotals();
  const prompts = emptyPrompts(options.prompts);
  for (const event of loaded.value.events) {
    if (event.kind === "request") {
      addRequest(totals, requestUsage(event));
    } else if (event.kind === "tool_result" && event.payload.isError === true) {
      totals.failedTools += 1;
    } else if (event.kind === "user" && isPrompt(event)) {
      totals.turns += 1;
      prompts.add(event.payload.text ?? "");
    }
  }
  return ok(finishPass(totals, loaded.value.capabilities, 0, prompts.list));
}

async function detectOpenCode(platform: SessionPlatform, ref: SessionRef): Promise<boolean> {
  if (!ref.path.endsWith(".db") || ref.sessionId === undefined) {
    return false;
  }
  const database = openDatabase(platform, ref.path);
  if (!database.ok) {
    return false;
  }
  try {
    return database.value.prepare("SELECT 1 AS present FROM session WHERE id = ?").get(ref.sessionId) !== undefined;
  } finally {
    database.value.close();
  }
}

/**
 * OpenCode keeps sessions in `opencode.db`: one `session` row, `message` rows in creation order, and `part` rows for
 * each message's text, reasoning, tool calls and step boundaries. A session id selects the rows; the database path is
 * the ref's path for every session in it.
 */
export const opencodeSessionAdapter: SessionAdapter = {
  specificationVersion: "sessions-v1",
  agent: OPENCODE_ID,
  displayName: OPENCODE_ID,
  capabilities: OPENCODE_CAPABILITIES,
  roots: (home) => [home.path],
  discover: discoverOpenCode,
  detect: detectOpenCode,
  load: loadOpenCode,
  summarize: (platform, ref, options = {}) => summarizeOpenCode(platform, ref, options)
};
