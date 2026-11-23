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
  addRequestDuration,
  detectEventCapabilities,
  emptyPrompts,
  emptyTotals,
  finishPass
} from "../../../domain/transcript/services/fold-transcript.js";
import { markOrphanToolResults } from "../../../domain/transcript/services/tool-result-pairing.js";
import { promptSnapshot, snapshotHasSystemPrompt } from "../../../domain/transcript/services/prompt-snapshot.js";
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
import { advanceTime, mergeLanes } from "./lane-merge.js";
import { type Compaction, partOf, rememberCompaction, type SqliteSessionPart } from "./sqlite-parts.js";

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
  readonly completed?: number | undefined;
  readonly usage: Usage | undefined;
  /** True when this message was copied from a parent session (e.g. fork/side-chat/workflow seed) and must be skipped when attached as a child lane. */
  readonly inherited?: boolean | undefined;
}

/**
 * The agent's entry rows (`session_entry` in ZCode) that snapshot the conversation's opening prompt. The adapter
 * reads only the rows of `entryType`, so the other entry types stay unread records; each read row becomes a
 * `prompt_snapshot` event or a skipped record.
 */
interface SqliteSessionPromptSnapshots {
  /** The table the entries live in, such as `session_entry`. */
  readonly table: string;
  /** The entry `type` the snapshots are stored under, such as `runtime/prompt_snapshot`. */
  readonly entryType: string;
  /** The agent's reading of an entry's JSON; `undefined` skips the row as an invalid entry. */
  parse(value: unknown): { systemPrompt?: string } | undefined;
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
  /** Whether a linked session is a subagent; standalone branches must not contribute copied history to their parent. */
  isSubagent?(session: { readonly taskType: string | undefined }): boolean;
  /** The agent's reading of a message row's JSON; `undefined` skips the row as an invalid message. */
  message(value: unknown): SqliteSessionMessage | undefined;
  /** The entry rows that snapshot the conversation's opening prompt, when the agent records them. */
  readonly promptSnapshots?: SqliteSessionPromptSnapshots;
}

/** Everything a session of this layout can show; each transcript lists the subset its rows show. */
const CAPABILITIES: readonly Capability[] = [
  "requests",
  "usage",
  "durations",
  "reasoning",
  "compaction",
  "compactionTokens",
  "subagents"
];

/** `systemPrompt` joins the list only when the layout reads prompt snapshot entries. */
function adapterCapabilities(layout: SqliteSessionLayout): readonly Capability[] {
  return layout.promptSnapshots === undefined ? CAPABILITIES : [...CAPABILITIES, "systemPrompt"];
}

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
  parent_id: TextColumn,
  task_type: lenient(z.string()),
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

const EntryRow = z.object({ rowid: IntegerColumn, id: TextColumn, time_created: IntegerColumn, data: TextColumn });
type EntryRow = z.infer<typeof EntryRow>;

const MessageKey = z.object({ rowid: IntegerColumn, id: TextColumn, time_created: IntegerColumn });

function requestDuration(message: SqliteSessionMessage): number | undefined {
  const { created, completed } = message;
  if (
    created === undefined ||
    completed === undefined ||
    !Number.isFinite(created) ||
    !Number.isFinite(completed) ||
    completed < created
  ) {
    return undefined;
  }
  const duration = completed - created;
  return Number.isFinite(duration) ? duration : undefined;
}

function capabilitiesOf(
  events: readonly TranscriptEvent[],
  subagents: number,
  capabilities: readonly Capability[]
): Capability[] {
  const seen = new Set(detectEventCapabilities(events));
  if (events.some((event) => event.kind === "request" && event.payload.durationMs !== undefined)) {
    seen.add("durations");
  }
  if (subagents > 0) {
    seen.add("subagents");
  }
  if (events.some((event) => snapshotHasSystemPrompt(promptSnapshot(event)))) {
    seen.add("systemPrompt");
  }
  return capabilities.filter((capability) => seen.has(capability));
}

interface SessionRows {
  session: SessionRow;
  messages: MessageRow[];
  parts: PartRow[];
  entries: EntryRow[];
}

/** An open SQLite database of the platform. */
export type SqliteDatabase = ReturnType<NonNullable<SessionPlatform["sqlite"]>["open"]>;
type Database = SqliteDatabase;

/** A `ReadFailed` with the message and, when given, the cause. */
export function readFailed(path: string, message: string, cause?: unknown): ReadFailed {
  return definedFields({ _tag: "ReadFailed" as const, path, message, cause });
}

/** A `ReadFailed` from a thrown value. */
export function thrown(path: string, error: unknown): ReadFailed {
  return readFailed(path, error instanceof Error ? error.message : String(error), error);
}

/** A `SourcePointer` for one SQLite row and column. */
export function sqliteSource(file: string, table: string, column: string, rowid: number, line: number): SourcePointer {
  return { file, offset: 0, length: 0, line, sqlite: { table, column, rowid } };
}

function source(
  file: string,
  table: "session" | "message" | "part",
  column: string,
  rowid: number,
  line: number
): SourcePointer {
  return sqliteSource(file, table, column, rowid, line);
}

/** Opens the database read-only, or a `ReadFailed` when the platform has no SQLite or the open throws. */
export function openDatabase(platform: SessionPlatform, path: string): Result<SqliteDatabase, ReadFailed> {
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

const TableInfoRow = z.looseObject({ name: z.string() });

function hasColumn(database: Database, table: "session" | "message", column: string): boolean {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((row) => z.safeParse(TableInfoRow, row).data?.name === column);
}

function hasTable(database: Database, table: string | undefined): boolean {
  if (table === undefined) {
    return false;
  }
  return (
    database.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !==
    undefined
  );
}

/** Queries adapted to the live-session, parent and message-order columns this database actually has. */
function queriesOf(
  softDeletes: boolean,
  messageSequence: boolean,
  parentIds: boolean,
  taskTypes: boolean,
  entryTable: string | undefined
) {
  const live = softDeletes ? "time_deleted IS NULL" : undefined;
  const order = messageSequence ? "sequence, time_created, id" : "time_created, id";
  const byId = live === undefined ? "id = ?" : `id = ? AND ${live}`;
  const sessionColumns = `rowid, id, title, directory, time_created, time_updated, version${parentIds ? ", parent_id" : ""}${taskTypes ? ", task_type" : ""}`;
  return {
    sessions: `SELECT ${sessionColumns} FROM session ${live === undefined ? "" : `WHERE ${live} `}ORDER BY time_updated DESC, id`,
    session: `SELECT ${sessionColumns} FROM session WHERE ${byId}`,
    children: parentIds
      ? `SELECT ${sessionColumns} FROM session WHERE parent_id = ?${live === undefined ? "" : ` AND ${live}`} ORDER BY time_created, id`
      : undefined,
    sessionPresent: `SELECT 1 AS present FROM session WHERE ${byId}`,
    messages: `SELECT rowid, id, time_created, data FROM message WHERE session_id = ? ORDER BY ${order}`,
    messageKeys: `SELECT rowid, id, time_created FROM message WHERE session_id = ? ORDER BY ${order}`,
    messageData: `SELECT data FROM message WHERE rowid = ?`,
    parts: `SELECT rowid, id, message_id, time_created, data FROM part WHERE session_id = ? ORDER BY time_created, id`,
    partsOfMessage: `SELECT rowid, time_created, data FROM part WHERE session_id = ? AND message_id = ? ORDER BY time_created, id`,
    entries:
      entryTable === undefined
        ? undefined
        : `SELECT rowid, id, time_created, data FROM ${entryTable} WHERE session_id = ? AND type = ? ORDER BY time_created, id`
  };
}

function queriesForDatabase(layout: SqliteSessionLayout, database: Database): Queries {
  const softDeletes = layout.softDeletes && hasColumn(database, "session", "time_deleted");
  const messageSequence = layout.messageSequence && hasColumn(database, "message", "sequence");
  const entryTable = hasTable(database, layout.promptSnapshots?.table) ? layout.promptSnapshots?.table : undefined;
  return queriesOf(
    softDeletes,
    messageSequence,
    hasColumn(database, "session", "parent_id"),
    hasColumn(database, "session", "task_type"),
    entryTable
  );
}

type Queries = ReturnType<typeof queriesOf>;

function isSubagent(layout: SqliteSessionLayout, row: SessionRow): boolean {
  return layout.isSubagent?.({ taskType: row.task_type }) ?? true;
}

/** Parent edges are classified before cycle detection, so a standalone fork breaks the chain too. */
function discoverableSessions(layout: SqliteSessionLayout, rows: SessionRow[]): SessionRow[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const parents = new Map(
    rows.map((row) => [
      row.id,
      row.parent_id && byId.has(row.parent_id) && isSubagent(layout, row) ? row.parent_id : undefined
    ])
  );
  const roots = new Set(rows.filter((row) => parents.get(row.id) === undefined).map((row) => row.id));
  const visited = new Set<string>();
  for (const row of rows) {
    const path: string[] = [];
    const positions = new Map<string, number>();
    let at: string | undefined = row.id;
    while (at !== undefined && !visited.has(at) && !positions.has(at)) {
      positions.set(at, path.length);
      path.push(at);
      at = parents.get(at);
    }
    const cycleStart = at === undefined ? undefined : positions.get(at);
    if (cycleStart !== undefined) {
      const cycle = path.slice(cycleStart);
      roots.add(cycle.reduce((smallest, id) => (id < smallest ? id : smallest)));
    }
    for (const id of path) {
      visited.add(id);
    }
  }
  return rows.filter((row) => roots.has(row.id));
}

/** Iterative traversal also handles corrupt parent cycles without overflowing the call stack. */
function sessionTree(
  layout: SqliteSessionLayout,
  database: Database,
  queries: Queries,
  root: SessionRow,
  signal: AbortSignal | undefined
): SessionRow[] {
  const sessions = [root];
  const visited = new Set([root.id]);
  if (queries.children === undefined) {
    return sessions;
  }
  const children = database.prepare(queries.children);
  for (let index = 0; index < sessions.length; index++) {
    signal?.throwIfAborted();
    for (const row of children.all(sessions[index]!.id)) {
      const child = z.parse(SessionRow, row);
      if (!visited.has(child.id) && isSubagent(layout, child)) {
        visited.add(child.id);
        sessions.push(child);
      }
    }
  }
  return sessions;
}

function readRows(
  layout: SqliteSessionLayout,
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
    const promptSnapshots = layout.promptSnapshots;
    const entries =
      queries.entries === undefined || promptSnapshots === undefined
        ? []
        : database
            .prepare(queries.entries)
            .all(sessionId, promptSnapshots.entryType)
            .map((row) => z.parse(EntryRow, row));
    return ok({
      session: z.parse(SessionRow, session),
      messages: messages.map((row) => z.parse(MessageRow, row)),
      parts: parts.map((row) => z.parse(PartRow, row)),
      entries
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

function translate(
  layout: SqliteSessionLayout,
  rows: SessionRows,
  dbPath: string,
  firstLine: number,
  skipInherited = false
): Transcript {
  let events: TranscriptEvent[] = [];
  const skipped: SkippedRecord[] = [];
  const compactions = new Map<string, Compaction>();
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

  skipped.push({ reason: "session-header", source: source(dbPath, "session", "title", rows.session.rowid, firstLine) });
  let line = firstLine + 1;

  // Prompt snapshot entries precede the message walk: a snapshot records the conversation's opening prompt, and
  // ZCode writes the entry when the session opens. The last readable entry's prompt is the session's, the way a
  // later snapshot replaces an earlier one.
  let systemPrompt: string | undefined;
  for (const entryRow of rows.entries) {
    const entrySource = sqliteSource(
      dbPath,
      layout.promptSnapshots?.table ?? "session_entry",
      "data",
      entryRow.rowid,
      line++
    );
    const entryJson = parseJson(entryRow.data);
    if (!entryJson.ok) {
      skip(entrySource, "invalid-entry");
      continue;
    }
    const snapshot = layout.promptSnapshots?.parse(entryJson.value);
    if (snapshot === undefined) {
      skip(entrySource, "invalid-entry");
      continue;
    }
    if (snapshot.systemPrompt === undefined) {
      skip(entrySource, "empty-prompt-snapshot");
      continue;
    }
    systemPrompt = snapshot.systemPrompt;
    events.push(
      baseEvent(
        { ...entrySource, value: entryJson.value },
        "system",
        { type: "prompt_snapshot", systemPrompt: snapshot.systemPrompt },
        { id: entryRow.id, ts: entryRow.time_created }
      )
    );
  }

  function decodePart(
    partRow: PartRow
  ): { source: SourcePointer; value: unknown; part: SqliteSessionPart | undefined } | undefined {
    const partSource = source(dbPath, "part", "data", partRow.rowid, line++);
    const partJson = parseJson(partRow.data);
    if (!partJson.ok) {
      skip(partSource, "invalid-json");
      return undefined;
    }
    return { source: partSource, value: partJson.value, part: partOf(partJson.value) };
  }

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
    if (skipInherited && message.inherited) {
      skip(messageSource, "inherited-message");
      for (const partRow of parts) {
        skip(source(dbPath, "part", "data", partRow.rowid, line++), "inherited-message-part");
      }
      continue;
    }
    const created = message.created ?? messageRow.time_created;

    if (message.role === "user") {
      skip(messageSource, "user-message-envelope");
      for (const partRow of parts) {
        const decoded = decodePart(partRow);
        if (decoded === undefined) {
          continue;
        }
        if (decoded.part?.type === "text" && decoded.part.text) {
          events.push(
            baseEvent({ ...decoded.source, value: decoded.value }, "user", { text: decoded.part.text }, { ts: created })
          );
        } else if (decoded.part?.type === "compaction") {
          const payload = rememberCompaction(compactions, decoded.part, message.role, partRow.rowid);
          if (payload === undefined) {
            skip(decoded.source, `compaction:${decoded.part.timelineStatus}`);
          } else {
            events.push(
              baseEvent({ ...decoded.source, value: decoded.value }, "compaction", payload, {
                ts: decoded.part.time?.start ?? partRow.time_created
              })
            );
          }
        } else {
          skip(decoded.source, `part:${decoded.part?.type ?? "unreadable"}`);
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
          durationMs: requestDuration(message),
          usage: message.usage
        }),
        { id: messageRow.id, ts: created, requestId: requestKey }
      )
    );

    for (const partRow of parts) {
      const decoded = decodePart(partRow);
      if (decoded === undefined) {
        continue;
      }
      const { source: partSource, value: partValue, part } = decoded;
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
      } else if (part.type === "compaction") {
        const payload = rememberCompaction(compactions, part, message.role, partRow.rowid);
        if (payload === undefined) {
          skip(partSource, `compaction:${part.timelineStatus}`);
        } else {
          events.push(
            baseEvent({ ...partSource, value: partValue }, "compaction", payload, { ts, requestId: requestKey })
          );
        }
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

  const selectedCompactions = new Set(Array.from(compactions.values(), (compaction) => compaction.rowid));
  events = events.filter((event) => {
    if (event.kind !== "compaction" || selectedCompactions.has(event.source.sqlite!.rowid)) {
      return true;
    }
    skip(event.source, "duplicate-compaction");
    return false;
  });
  assignSeq(events);
  const session: TranscriptSession = definedFields({
    id: rows.session.id,
    title: rows.session.title === "" ? undefined : rows.session.title,
    cwd: rows.session.directory === "" ? undefined : rows.session.directory,
    startedAt: rows.session.time_created === 0 ? undefined : rows.session.time_created,
    endedAt: rows.session.time_updated === 0 ? undefined : rows.session.time_updated,
    ...(systemPrompt === undefined ? {} : { systemPrompt })
  });
  const capabilities = capabilitiesOf(events, 0, adapterCapabilities(layout));
  const parsed: ParsedTranscript = definedFields({
    events,
    skipped,
    session,
    agentVersion: rows.session.version === "" ? undefined : rows.session.version,
    agents: [{ id: MAIN_LANE_ID }]
  });
  return createTranscript(layout.agent, capabilities, parsed);
}

interface SummaryRequest {
  kind: "request";
  priorTs: number;
  ts: number;
  model: string | undefined;
  usage: Usage | undefined;
  durationMs: number | undefined;
}

type SummaryStep = SummaryRequest | { kind: "compaction"; priorTs: number; ts: number; rowid: number };

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
  const root = database.prepare(queries.session).get(sessionId);
  if (root === undefined) {
    return err({ _tag: "SessionNotFound", path });
  }
  const sessions = sessionTree(layout, database, queries, z.parse(SessionRow, root), options.signal);
  const totals = emptyTotals();
  const prompts = emptyPrompts(options.prompts);
  const seen = new Set<Capability>();
  const lanes: SummaryRequest[][] = [];
  const messageData = database.prepare(queries.messageData);
  const partsOf = database.prepare(queries.partsOfMessage);
  for (const session of sessions) {
    const compactions = new Map<string, Compaction>();
    // Keep only request facts and potential compaction boundaries. Other emitted events (including prompt snapshots
    // emitted before the session's messages) contribute a maximum timestamp between them; discarded mirrors must not
    // advance the clock of the following request.
    const steps: SummaryStep[] = [];
    let priorTs = -Infinity;
    const promptSnapshots = layout.promptSnapshots;
    if (queries.entries !== undefined && promptSnapshots !== undefined) {
      for (const row of database.prepare(queries.entries).all(session.id, promptSnapshots.entryType)) {
        const json = parseJson(z.parse(TextColumn, row.data));
        const snapshot = json.ok ? layout.promptSnapshots?.parse(json.value) : undefined;
        if (snapshot?.systemPrompt !== undefined) {
          seen.add("systemPrompt");
          priorTs = advanceTime(priorTs, z.parse(IntegerColumn, row.time_created));
        }
      }
    }
    const messageKeys = database
      .prepare(queries.messageKeys)
      .all(session.id)
      .map((row) => z.parse(MessageKey, row));
    for (const key of messageKeys) {
      options.signal?.throwIfAborted();
      const json = parseJson(z.parse(TextColumn, messageData.get(key.rowid)?.data));
      const message = json.ok ? layout.message(json.value) : undefined;
      if (
        message === undefined ||
        (session.id !== sessionId && message.inherited) ||
        (message.role !== "user" && message.role !== "assistant")
      ) {
        continue;
      }
      const ts = message.created ?? key.time_created;
      if (message.role === "assistant") {
        const durationMs = requestDuration(message);
        seen.add("requests");
        if (message.usage !== undefined) {
          seen.add("usage");
        }
        if (durationMs !== undefined) {
          seen.add("durations");
        }
        steps.push({ kind: "request", priorTs, ts, model: message.model, usage: message.usage, durationMs });
        priorTs = -Infinity;
      }
      for (const row of partsOf.all(session.id, key.id)) {
        const partJson = parseJson(z.parse(TextColumn, row.data));
        const part = partJson.ok ? partOf(partJson.value) : undefined;
        if (part === undefined) {
          continue;
        }
        const partTs = part.time?.start ?? z.parse(IntegerColumn, row.time_created);
        if (part.type === "compaction") {
          const rowid = z.parse(IntegerColumn, row.rowid);
          if (rememberCompaction(compactions, part, message.role, rowid) !== undefined) {
            steps.push({ kind: "compaction", priorTs, ts: partTs, rowid });
            priorTs = -Infinity;
          }
        } else if (message.role === "user") {
          if (part.type === "text" && part.text) {
            priorTs = advanceTime(priorTs, ts);
            if (session.id === sessionId) {
              totals.turns += 1;
              // Main-lane order is invariant under the merge, so these are already the earliest candidates.
              if (prompts.list !== undefined && prompts.list.length < (options.prompts?.limit ?? 0)) {
                prompts.add(part.text);
              }
            }
          }
        } else if (part.type === "text" || part.type === "reasoning") {
          priorTs = advanceTime(priorTs, partTs);
          if (part.type === "reasoning") {
            seen.add("reasoning");
          }
        } else if (part.type === "tool") {
          priorTs = advanceTime(priorTs, partTs);
          const state = part.state;
          if (state?.status === "completed" || state?.status === "error") {
            priorTs = advanceTime(priorTs, state.time?.end ?? partTs);
            if (state.status === "error" || state.error !== undefined) {
              totals.failedTools += 1;
            }
          }
        }
      }
    }
    const selectedCompactions = new Set(Array.from(compactions.values(), (compaction) => compaction.rowid));
    const requests: SummaryRequest[] = [];
    let clock = -Infinity;
    for (const step of steps) {
      clock = advanceTime(clock, step.priorTs);
      if (step.kind === "compaction" && !selectedCompactions.has(step.rowid)) {
        continue;
      }
      clock = advanceTime(clock, step.ts);
      if (step.kind === "request") {
        step.ts = clock;
        requests.push(step);
      }
    }
    lanes.push(requests);
    for (const compaction of compactions.values()) {
      totals.compactions += 1;
      seen.add("compaction");
      if (compaction.payload.preTokens !== undefined) {
        seen.add("compactionTokens");
      }
    }
  }
  if (sessions.length > 1) {
    seen.add("subagents");
  }
  for (const request of mergeLanes(lanes)) {
    // The billed fields of the request event the load gives the message.
    addRequest(
      totals,
      requestUsage({
        payload: definedFields({ granularity: "request" as const, model: request.model, usage: request.usage })
      })
    );
    addRequestDuration(totals, request.durationMs);
  }
  const capabilities = adapterCapabilities(layout).filter((capability) => seen.has(capability));
  return ok(finishPass(totals, capabilities, sessions.length - 1, prompts.list));
}

/**
 * The session adapter of an agent that keeps every session in one SQLite database: one `session` row, `message` rows
 * with the message as JSON in the `data` column, and `part` rows for each message's text, reasoning, tool calls and
 * step boundaries. A session id selects the rows; the database path is the ref's path for every session in it. The
 * layout and the part JSON are OpenCode's, which agents built on it keep.
 */
export function createSqliteSessionAdapter(layout: SqliteSessionLayout): SessionAdapter {
  const { agent } = layout;
  const extension = layout.databaseFile.slice(layout.databaseFile.lastIndexOf("."));
  const failure = (path: string, error: ReadFailed): SessionListFailure => ({ ref: { agent, path }, error });

  /** Opens the ref's database for one session, closing it after `read`. */
  async function withSession<T>(
    platform: SessionPlatform,
    ref: SessionRef,
    signal: AbortSignal | undefined,
    read: (database: Database, queries: Queries, sessionId: string) => Result<T, SessionReadError>
  ): Promise<Result<T, SessionReadError>> {
    signal?.throwIfAborted();
    if (ref.sessionId === undefined) {
      return err(readFailed(ref.path, `${layout.sessionNoun} needs its session id`));
    }
    const database = openDatabase(platform, ref.path);
    if (!database.ok) {
      return database;
    }
    let queries: Queries;
    try {
      queries = queriesForDatabase(layout, database.value);
    } catch (error) {
      database.value.close();
      return err(thrown(ref.path, error));
    }
    try {
      return read(database.value, queries, ref.sessionId);
    } finally {
      database.value.close();
    }
  }

  return {
    specificationVersion: "sessions-v1",
    agent,
    displayName: agent,
    capabilities: adapterCapabilities(layout),
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
        const queries = queriesForDatabase(layout, database.value);
        const rows = discoverableSessions(
          layout,
          database.value
            .prepare(queries.sessions)
            .all()
            .map((row) => z.parse(SessionRow, row))
        );
        options.onTotal?.(rows.length);
        for (const row of rows) {
          yield headOf(agent, path, row, info);
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
        const queries = queriesForDatabase(layout, database.value);
        return database.value.prepare(queries.sessionPresent).get(ref.sessionId) !== undefined;
      } catch {
        return false;
      } finally {
        database.value.close();
      }
    },
    load: (platform, ref, options: LoadOptions = {}) =>
      withSession(platform, ref, options.signal, (database, queries, sessionId) => {
        try {
          options.signal?.throwIfAborted();
          const rows = readRows(layout, database, queries, ref.path, sessionId);
          if (!rows.ok) {
            return rows;
          }
          const sessions = sessionTree(layout, database, queries, rows.value.session, options.signal);
          const transcript = translate(layout, rows.value, ref.path, 1);
          const lanes = [transcript.events];
          // Line-based event ids and record accounting must stay unique across lanes sharing one database path.
          let nextLine = 2 + rows.value.entries.length + rows.value.messages.length + rows.value.parts.length;
          for (const child of sessions.slice(1)) {
            options.signal?.throwIfAborted();
            const childRows = readRows(layout, database, queries, ref.path, child.id);
            if (!childRows.ok) {
              return childRows;
            }
            const childTranscript = translate(layout, childRows.value, ref.path, nextLine, true);
            nextLine +=
              1 + childRows.value.entries.length + childRows.value.messages.length + childRows.value.parts.length;
            transcript.agents.push(
              definedFields({
                id: child.id,
                parentId: child.parent_id === sessionId ? MAIN_LANE_ID : child.parent_id,
                title: child.title || undefined,
                ...(childTranscript.session.systemPrompt === undefined
                  ? {}
                  : { systemPrompt: childTranscript.session.systemPrompt })
              })
            );
            for (const event of childTranscript.events) {
              event.agentId = child.id;
            }
            lanes.push(childTranscript.events);
            for (const skipped of childTranscript.skipped) {
              transcript.skipped.push(skipped);
            }
          }
          transcript.events = mergeLanes(lanes);
          markOrphanToolResults(transcript.events);
          assignSeq(transcript.events);
          transcript.capabilities = capabilitiesOf(transcript.events, sessions.length - 1, adapterCapabilities(layout));
          return ok(transcript);
        } catch (error) {
          options.signal?.throwIfAborted();
          return err(thrown(ref.path, error));
        }
      }),
    summarize: (platform, ref, options = {}) =>
      withSession(platform, ref, options.signal, (database, queries, sessionId) => {
        try {
          options.signal?.throwIfAborted();
          return summarize(layout, queries, database, ref.path, sessionId, options);
        } catch (error) {
          options.signal?.throwIfAborted();
          return err(thrown(ref.path, error));
        }
      })
  };
}
