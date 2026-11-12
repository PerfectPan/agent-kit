import { type CodingAgentId, definedFields, err, ok, type Result } from "@rivus/agent-kit-catalog/public";
import * as z from "zod/mini";

import { lenient } from "../../../lib/lenient.js";
import { joinPath } from "../../../lib/paths.js";
import { type ReadFailed, type SessionNotFound } from "../../../domain/session/errors/session-read-error.js";
import { SESSION_TITLE_MAX } from "../../../domain/session/factories/session-head.js";
import { type SessionHead, type SessionListFailure } from "../../../domain/session/value-objects/session-head.js";
import { type SessionRef } from "../../../domain/session/value-objects/session-ref.js";
import {
  type SessionPromptsOptions,
  type SessionSummaryWithPrompts
} from "../../../domain/session/value-objects/session-summary.js";
import {
  type ParsedTranscript,
  baseEvent,
  createTranscript
} from "../../../domain/transcript/factories/transcript-event.js";
import { assignSeq } from "../../../domain/transcript/services/event-ordering.js";
import {
  addRequest,
  emptyPrompts,
  emptyTotals,
  finishPass
} from "../../../domain/transcript/services/fold-transcript.js";
import { markOrphanToolResults } from "../../../domain/transcript/services/tool-result-pairing.js";
import { MAIN_LANE_ID, requestUsage } from "../../../domain/transcript/services/turns.js";
import { type SkippedRecord, type SourcePointer } from "../../../domain/transcript/value-objects/source-pointer.js";
import { type TranscriptEvent } from "../../../domain/transcript/value-objects/transcript-event.js";
import {
  type Capability,
  type Transcript,
  type TranscriptSession
} from "../../../domain/transcript/value-objects/transcript.js";
import { type Usage } from "../../../domain/usage/value-objects/usage.js";
import type { LoadOptions, SessionAdapter, SessionPlatform, SessionReadError } from "../../spi.js";

/**
 * A stored `message` row's JSON as the shared reader uses it. Each agent parses its own message JSON into this,
 * since the model field's spelling and the meaning of the token counts differ between agents.
 */
export interface SqliteSessionMessage {
  readonly role: string;
  readonly model: string | undefined;
  readonly finish: string | undefined;
  /** The message's own creation time; the row's `time_created` stands in when it is absent. */
  readonly created: number | undefined;
  readonly usage: Usage | undefined;
}

/** What differs between the agents that keep sessions in the `session`/`message`/`part` table layout. */
export interface SqliteSessionLayout {
  readonly agent: CodingAgentId;
  /** The database file below a session root, such as `opencode.db`; a ref is detected by its extension. */
  readonly databaseFile: string;
  /** The session as an error message names it, such as `an OpenCode session`. */
  readonly sessionNoun: string;
  /** The `session` table soft-deletes rows by setting `time_deleted`; such a session no longer exists. */
  readonly softDeletes: boolean;
  /** The `message` table orders a session's rows by its `sequence` column before their creation time. */
  readonly messageSequence: boolean;
  /** The agent's reading of a message row's JSON; `undefined` skips the row as an invalid message. */
  message(value: unknown): SqliteSessionMessage | undefined;
}

/** Everything a session of this layout can show; each transcript lists the subset its rows show. */
const CAPABILITIES: readonly Capability[] = ["requests", "usage", "reasoning"];

/** SQLite hands back `null | number | bigint | string | Uint8Array`; a column of another type reads as 0 or "". */
const IntegerColumn = z.catch(
  z.union([
    z.number(),
    z.pipe(
      z.bigint(),
      z.transform((value) => Number(value))
    )
  ]),
  0
);
const TextColumn = z.catch(z.string(), "");

const SessionRow = z.object({
  rowid: IntegerColumn,
  id: TextColumn,
  title: TextColumn,
  directory: TextColumn,
  time_created: IntegerColumn,
  time_updated: IntegerColumn,
  version: TextColumn
});
type SessionRow = z.infer<typeof SessionRow>;

const MessageRow = z.object({ rowid: IntegerColumn, id: TextColumn, time_created: IntegerColumn, data: TextColumn });
type MessageRow = z.infer<typeof MessageRow>;

const PartRow = z.object({
  rowid: IntegerColumn,
  id: TextColumn,
  message_id: TextColumn,
  time_created: IntegerColumn,
  data: TextColumn
});
type PartRow = z.infer<typeof PartRow>;

const MessageKey = z.object({ rowid: IntegerColumn, id: TextColumn });

const Span = z.looseObject({ start: lenient(z.number()), end: lenient(z.number()) });

/** A stored `part` row's JSON; every agent of this layout writes the same shape. */
const PartData = z.looseObject({
  type: z.string(),
  text: lenient(z.string()),
  tool: lenient(z.string()),
  callID: lenient(z.string()),
  state: lenient(
    z.looseObject({
      status: lenient(z.string()),
      input: lenient(z.unknown()),
      output: lenient(z.unknown()),
      error: lenient(z.unknown()),
      time: lenient(Span)
    })
  ),
  time: lenient(Span)
});

function partOf(value: unknown): z.infer<typeof PartData> | undefined {
  return z.safeParse(PartData, value).data;
}

interface SessionRows {
  session: SessionRow;
  messages: MessageRow[];
  parts: PartRow[];
}

type Database = ReturnType<NonNullable<SessionPlatform["sqlite"]>["open"]>;

function readFailed(path: string, message: string, cause?: unknown): ReadFailed {
  return definedFields({ _tag: "ReadFailed" as const, path, message, cause });
}

function thrown(path: string, error: unknown): ReadFailed {
  return readFailed(path, error instanceof Error ? error.message : String(error), error);
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
    return err(thrown(path, error));
  }
}

/** The SQL a layout reads with: the live-session filter and the message order are the layout's only differences. */
function queriesOf(layout: SqliteSessionLayout) {
  const live = layout.softDeletes ? "time_deleted IS NULL" : undefined;
  const order = layout.messageSequence ? "sequence, time_created, id" : "time_created, id";
  const byId = live === undefined ? "id = ?" : `id = ? AND ${live}`;
  const sessionColumns = "rowid, id, title, directory, time_created, time_updated, version";
  return {
    sessions: `SELECT ${sessionColumns} FROM session ${live === undefined ? "" : `WHERE ${live} `}ORDER BY time_updated DESC`,
    session: `SELECT ${sessionColumns} FROM session WHERE ${byId}`,
    sessionPresent: `SELECT 1 AS present FROM session WHERE ${byId}`,
    messages: `SELECT rowid, id, time_created, data FROM message WHERE session_id = ? ORDER BY ${order}`,
    messageKeys: `SELECT rowid, id FROM message WHERE session_id = ? ORDER BY ${order}`,
    messageData: `SELECT data FROM message WHERE rowid = ?`,
    parts: `SELECT rowid, id, message_id, time_created, data FROM part WHERE session_id = ? ORDER BY time_created, id`,
    partsOfMessage: `SELECT rowid, time_created, data FROM part WHERE session_id = ? AND message_id = ? ORDER BY time_created, id`
  };
}

type Queries = ReturnType<typeof queriesOf>;

function readRows(
  database: Database,
  queries: Queries,
  path: string,
  sessionId: string
): Result<SessionRows, SessionNotFound | ReadFailed> {
  try {
    const session = database.prepare(queries.session).get(sessionId);
    if (session === undefined) {
      return err({ _tag: "SessionNotFound", path });
    }
    const messages = database.prepare(queries.messages).all(sessionId);
    const parts = database.prepare(queries.parts).all(sessionId);
    return ok({
      session: z.parse(SessionRow, session),
      messages: messages.map((row) => z.parse(MessageRow, row)),
      parts: parts.map((row) => z.parse(PartRow, row))
    });
  } catch (error) {
    return err(thrown(path, error));
  }
}

function headOf(
  agent: CodingAgentId,
  path: string,
  row: SessionRow,
  file: { size: number; mtimeMs: number }
): SessionHead {
  return definedFields({
    ref: { agent, path, sessionId: row.id },
    lastActiveAt: row.time_updated || row.time_created || file.mtimeMs,
    sizeBytes: file.size,
    title: row.title === "" ? undefined : row.title.slice(0, SESSION_TITLE_MAX),
    cwd: row.directory === "" ? undefined : row.directory,
    startedAt: row.time_created === 0 ? undefined : row.time_created
  });
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

function translate(layout: SqliteSessionLayout, rows: SessionRows, dbPath: string): Transcript {
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
    const messageJson = parseJson(messageRow.data);
    if (!messageJson.ok) {
      skip(messageSource, "invalid-json");
      continue;
    }
    const messageValue = messageJson.value;
    const message = layout.message(messageValue);
    if (message === undefined) {
      skip(messageSource, "invalid-message");
      continue;
    }
    const created = message.created ?? messageRow.time_created;

    if (message.role === "user") {
      skip(messageSource, "user-message-envelope");
      for (const partRow of parts) {
        const partSource = source(dbPath, "part", "data", partRow.rowid, line++);
        const partJson = parseJson(partRow.data);
        if (!partJson.ok) {
          skip(partSource, "invalid-json");
          continue;
        }
        const part = partOf(partJson.value);
        if (part?.type === "text" && part.text) {
          events.push(
            baseEvent({ ...partSource, value: partJson.value }, "user", { text: part.text }, { ts: created })
          );
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
    events.push(
      baseEvent(
        { ...messageSource, value: messageValue },
        "request",
        definedFields({
          granularity: "request" as const,
          model: message.model,
          responseId: messageRow.id,
          finishReason: message.finish,
          usage: message.usage
        }),
        { id: messageRow.id, ts: created, requestId: requestKey }
      )
    );

    for (const partRow of parts) {
      const partSource = source(dbPath, "part", "data", partRow.rowid, line++);
      const partJson = parseJson(partRow.data);
      if (!partJson.ok) {
        skip(partSource, "invalid-json");
        continue;
      }
      const partValue = partJson.value;
      const part = partOf(partValue);
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
            definedFields({ callId, name: part.tool ?? "tool", args: state?.input }),
            { id: partRow.id, ts, requestId: requestKey }
          )
        );
        if (state?.status === "completed" || state?.status === "error") {
          events.push(
            baseEvent(
              { ...partSource, value: partValue },
              "tool_result",
              definedFields({
                callId,
                output: state.output,
                isError: state.status === "error" || state.error !== undefined ? true : undefined
              }),
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
  const session: TranscriptSession = definedFields({
    id: rows.session.id,
    title: rows.session.title === "" ? undefined : rows.session.title,
    cwd: rows.session.directory === "" ? undefined : rows.session.directory,
    startedAt: rows.session.time_created === 0 ? undefined : rows.session.time_created,
    endedAt: rows.session.time_updated === 0 ? undefined : rows.session.time_updated
  });
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
  const parsed: ParsedTranscript = definedFields({
    events,
    skipped,
    session,
    agentVersion: rows.session.version === "" ? undefined : rows.session.version,
    agents: [{ id: MAIN_LANE_ID }]
  });
  return createTranscript(layout.agent, capabilities, parsed);
}

/**
 * The summary of one session in a bounded pass: message rows stream one at a time — the message list carries only
 * ids, each message's `data` is fetched by rowid, and only that message's parts are loaded — so a large database
 * session never materializes the whole transcript.
 */
function summarize(
  layout: SqliteSessionLayout,
  queries: Queries,
  database: Database,
  path: string,
  sessionId: string,
  options: { signal?: AbortSignal; prompts?: SessionPromptsOptions }
): Result<SessionSummaryWithPrompts, SessionReadError> {
  if (database.prepare(queries.session).get(sessionId) === undefined) {
    return err({ _tag: "SessionNotFound", path });
  }
  const totals = emptyTotals();
  const prompts = emptyPrompts(options.prompts);
  const seen = new Set<Capability>();
  const messageKeys = database
    .prepare(queries.messageKeys)
    .all(sessionId)
    .map((row) => z.parse(MessageKey, row));
  const messageData = database.prepare(queries.messageData);
  const partsOf = database.prepare(queries.partsOfMessage);
  const partsOfMessage = (messageId: string) =>
    partsOf.all(sessionId, messageId).map((row) => {
      const json = parseJson(z.parse(TextColumn, row.data));
      return json.ok ? partOf(json.value) : undefined;
    });
  for (const key of messageKeys) {
    options.signal?.throwIfAborted();
    const json = parseJson(z.parse(TextColumn, messageData.get(key.rowid)?.data));
    const message = json.ok ? layout.message(json.value) : undefined;
    if (message === undefined) {
      continue;
    }
    if (message.role === "user") {
      for (const part of partsOfMessage(key.id)) {
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
    if (message.usage !== undefined) {
      seen.add("usage");
    }
    addRequest(totals, requestUsage({ payload: definedFields({ usage: message.usage }) }));
    for (const part of partsOfMessage(key.id)) {
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
  const capabilities = CAPABILITIES.filter((capability) => seen.has(capability));
  return ok(finishPass(totals, capabilities, 0, prompts.list));
}

/**
 * The session adapter of an agent that keeps every session in one SQLite database: one `session` row, `message` rows
 * with the message as JSON in the `data` column, and `part` rows for each message's text, reasoning, tool calls and
 * step boundaries. A session id selects the rows; the database path is the ref's path for every session in it. The
 * layout and the part JSON are OpenCode's, which agents built on it keep.
 */
export function createSqliteSessionAdapter(layout: SqliteSessionLayout): SessionAdapter {
  const { agent } = layout;
  const queries = queriesOf(layout);
  const extension = layout.databaseFile.slice(layout.databaseFile.lastIndexOf("."));
  const failure = (path: string, error: ReadFailed): SessionListFailure => ({ ref: { agent, path }, error });

  /** Opens the ref's database for one session, closing it after `read`. */
  async function withSession<T>(
    platform: SessionPlatform,
    ref: SessionRef,
    read: (database: Database, sessionId: string) => Result<T, SessionReadError>
  ): Promise<Result<T, SessionReadError>> {
    if (ref.sessionId === undefined) {
      return err(readFailed(ref.path, `${layout.sessionNoun} needs its session id`));
    }
    const database = openDatabase(platform, ref.path);
    if (!database.ok) {
      return database;
    }
    try {
      return read(database.value, ref.sessionId);
    } finally {
      database.value.close();
    }
  }

  return {
    specificationVersion: "sessions-v1",
    agent,
    displayName: agent,
    capabilities: CAPABILITIES,
    roots: (home) => [home.path],
    async *discover(platform, root, options = {}) {
      const path = joinPath(root, layout.databaseFile);
      let info;
      try {
        info = await platform.fs.stat(path, { followSymlinks: true });
      } catch (error) {
        options.signal?.throwIfAborted();
        yield failure(path, readFailed(path, String(error), error));
        return;
      }
      if (info?.kind !== "file") {
        yield { ref: { agent, path: root }, error: { _tag: "RootMissing", path: root } };
        return;
      }
      const database = openDatabase(platform, path);
      if (!database.ok) {
        yield failure(path, database.error);
        return;
      }
      try {
        const rows = database.value.prepare(queries.sessions).all();
        options.onTotal?.(rows.length);
        for (const row of rows) {
          yield headOf(agent, path, z.parse(SessionRow, row), info);
        }
      } catch (error) {
        options.signal?.throwIfAborted();
        yield failure(path, readFailed(path, String(error), error));
      } finally {
        database.value.close();
      }
    },
    async detect(platform, ref) {
      if (!ref.path.endsWith(extension) || ref.sessionId === undefined) {
        return false;
      }
      const database = openDatabase(platform, ref.path);
      if (!database.ok) {
        return false;
      }
      try {
        return database.value.prepare(queries.sessionPresent).get(ref.sessionId) !== undefined;
      } finally {
        database.value.close();
      }
    },
    load: (platform, ref, options: LoadOptions = {}) =>
      withSession(platform, ref, (database, sessionId) => {
        options.signal?.throwIfAborted();
        const rows = readRows(database, queries, ref.path, sessionId);
        return rows.ok ? ok(translate(layout, rows.value, ref.path)) : rows;
      }),
    summarize: (platform, ref, options = {}) =>
      withSession(platform, ref, (database, sessionId) => {
        // An abort inside the pass surfaces as the pass's ReadFailed, like any other error it throws.
        try {
          options.signal?.throwIfAborted();
          return summarize(layout, queries, database, ref.path, sessionId, options);
        } catch (error) {
          return err(thrown(ref.path, error));
        }
      })
  };
}
