import { DIM_DATABASE, DIM_DISPLAY_NAME, DIM_HOME, DIM_ID } from "./facts.js";
import { definedFields, err, ok, type Result } from "@rivus/agent-kit-catalog/spi";
import {
  assignSeq,
  baseEvent,
  catchSessionRead,
  openDatabase,
  sqliteSource,
  type SessionPlatform,
  type SqliteDatabase,
  thrown,
  createTranscript,
  joinPath,
  lenient,
  markOrphanToolResults,
  SESSION_TITLE_MAX,
  type Capability,
  type LoadOptions,
  type ParsedTranscript,
  type SessionAdapter,
  type SessionHead,
  type SessionReadError,
  type SessionRef,
  type SkippedRecord,
  type SourcePointer,
  addRequest,
  addRequestDuration,
  emptyPrompts,
  emptyTotals,
  finishPass,
  type Transcript,
  type TranscriptEvent,
  type TranscriptSession
} from "@rivus/agent-kit-sessions/spi";
import * as z from "zod/mini";
import { dimLedgerRowOf, dimLedgerUsage, type DimLedgerRowValue } from "./records.js";

// The v2 SQLite database holds DimCode's sessions: the `sessions` table names each one (id, cwd, title, status,
// timestamps), and the `messages` table keeps one row per message with its AI-SDK-style `parts` JSON, an `orderKey`
// for the order, and a `metadata` JSON whose `runId` groups a message under one model run. Captured on 0.5.27; the
// tool calls a run made are not persisted as message rows, so transcripts show the conversation text only.

export const DIM_SESSION_CAPABILITIES: readonly Capability[] = ["requests", "usage", "durations", "reasoning"];

const TablePresentRow = z.looseObject({ name: z.string() });
const RunStatsRow = z.looseObject({
  runId: z.string(),
  durationMs: lenient(z.number())
});

function hasRunStatsTable(database: SqliteDatabase): boolean {
  const row = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'usage_run_stats'")
    .get();
  if (z.safeParse(TablePresentRow, row).data?.name !== "usage_run_stats") {
    return false;
  }
  const cols = new Set(
    database
      .prepare("PRAGMA table_info(usage_run_stats)")
      .all()
      .map((entry) => z.safeParse(TablePresentRow, entry).data?.name)
  );
  return cols.has("runId") && cols.has("sessionId") && cols.has("durationMs");
}

function readRunDurations(database: SqliteDatabase, sessionId: string): Map<string, number> {
  const durations = new Map<string, number>();
  if (!hasRunStatsTable(database)) {
    return durations;
  }
  const rows = database.prepare("SELECT runId, durationMs FROM usage_run_stats WHERE sessionId = ?").all(sessionId);
  for (const row of rows) {
    const parsed = z.safeParse(RunStatsRow, row).data;
    if (
      parsed !== undefined &&
      parsed.durationMs !== undefined &&
      Number.isFinite(parsed.durationMs) &&
      parsed.durationMs >= 0
    ) {
      durations.set(parsed.runId, parsed.durationMs);
    }
  }
  return durations;
}

function takeRunDuration(
  runId: string | undefined,
  runDurations: ReadonlyMap<string, number>,
  consumedRuns: Set<string>
): number | undefined {
  if (runId === undefined || consumedRuns.has(runId)) {
    return undefined;
  }
  const durationMs = runDurations.get(runId);
  if (durationMs !== undefined) {
    consumedRuns.add(runId);
  }
  return durationMs;
}

function dimCapabilities(events: readonly TranscriptEvent[]): Capability[] {
  const capabilities: Capability[] = [];
  if (events.some((event) => event.kind === "request")) {
    capabilities.push("requests");
  }
  if (events.some((event) => event.kind === "request" && event.payload.usage !== undefined)) {
    capabilities.push("usage");
  }
  if (events.some((event) => event.kind === "request" && event.payload.durationMs !== undefined)) {
    capabilities.push("durations");
  }
  if (events.some((event) => event.kind === "reasoning")) {
    capabilities.push("reasoning");
  }
  return capabilities;
}

export interface DimSessionRowValue {
  sessionId: string;
  cwd: string;
  title?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  latestMessageUpdatedAt?: string;
  latestMessageCreatedAt?: string;
  latestLedgerCreatedAt?: string;
  [field: string]: unknown;
}

export interface DimPartValue {
  type: string;
  text?: string;
  startTime?: string;
  endTime?: string;
  [field: string]: unknown;
}

export interface DimMessageValue {
  rowid: number;
  messageId: string;
  role: string;
  parts: DimPartValue[];
  /** The row's parsed `parts` column, which the row's events share as their original record. */
  rawParts: unknown[];
  runId?: string;
  orderKey: string;
  createdAt: number;
}

function iso(value: unknown): number {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function source(
  file: string,
  table: "messages" | "usage_ledger",
  column: string,
  rowid: number,
  line: number
): SourcePointer {
  return sqliteSource(file, table, column, rowid, line);
}

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

const DimSessionRow = z.looseObject({
  sessionId: z.string(),
  cwd: lenient(z.string()),
  title: lenient(z.optional(z.string())),
  status: lenient(z.string()),
  createdAt: lenient(z.string()),
  updatedAt: lenient(z.string()),
  latestMessageUpdatedAt: lenient(z.optional(z.string())),
  latestMessageCreatedAt: lenient(z.optional(z.string())),
  latestLedgerCreatedAt: lenient(z.optional(z.string()))
});

function sessionRowOf(value: unknown): DimSessionRowValue | undefined {
  const parsed = z.safeParse(DimSessionRow, value).data;
  return parsed === undefined
    ? undefined
    : {
        sessionId: parsed.sessionId,
        cwd: parsed.cwd ?? "",
        ...(parsed.title !== undefined ? { title: parsed.title } : {}),
        status: parsed.status ?? "",
        createdAt: parsed.createdAt ?? "",
        updatedAt: parsed.updatedAt ?? "",
        ...(parsed.latestMessageUpdatedAt !== undefined
          ? { latestMessageUpdatedAt: parsed.latestMessageUpdatedAt }
          : {}),
        ...(parsed.latestMessageCreatedAt !== undefined
          ? { latestMessageCreatedAt: parsed.latestMessageCreatedAt }
          : {}),
        ...(parsed.latestLedgerCreatedAt !== undefined ? { latestLedgerCreatedAt: parsed.latestLedgerCreatedAt } : {})
      };
}

const DimMessageRow = z.looseObject({
  messageId: z.string(),
  role: lenient(z.string()),
  parts: lenient(z.string()),
  metadata: lenient(z.optional(z.string())),
  orderKey: lenient(z.string()),
  createdAt: lenient(z.string()),
  updatedAt: lenient(z.string())
});

const DimPart = z.looseObject({
  type: z.string(),
  text: lenient(z.optional(z.string())),
  startTime: lenient(z.optional(z.string())),
  endTime: lenient(z.optional(z.string()))
});

/** One message row as the translation reads it; `undefined` for a row whose columns or parts JSON do not parse. */
export function dimMessageOf(row: unknown, rowid: number): DimMessageValue | undefined {
  const parsed = z.safeParse(DimMessageRow, row).data;
  if (parsed === undefined) {
    return undefined;
  }
  const parts: DimPartValue[] = [];
  let rawParts: unknown[] = [];
  try {
    const value = JSON.parse(parsed.parts ?? "") as unknown;
    if (Array.isArray(value)) {
      rawParts = value;
      for (const part of value) {
        const read = z.safeParse(DimPart, part).data;
        if (read !== undefined) {
          parts.push(
            definedFields({
              type: read.type,
              ...(read.text !== undefined ? { text: read.text } : {}),
              ...(read.startTime !== undefined ? { startTime: read.startTime } : {}),
              ...(read.endTime !== undefined ? { endTime: read.endTime } : {})
            })
          );
        }
      }
    }
  } catch {
    return undefined;
  }
  let runId: string | undefined;
  if (parsed.metadata !== undefined) {
    try {
      const meta = JSON.parse(parsed.metadata) as unknown;
      if (typeof meta === "object" && meta !== null && typeof (meta as Record<string, unknown>)["runId"] === "string") {
        runId = (meta as Record<string, string>)["runId"];
      }
    } catch {
      // A metadata envelope the kit cannot read still translates its parts.
    }
  }
  return {
    rowid,
    messageId: parsed.messageId,
    role: parsed.role ?? "",
    parts,
    rawParts,
    ...(runId !== undefined ? { runId } : {}),
    orderKey: parsed.orderKey ?? "",
    createdAt: iso(parsed.createdAt)
  };
}

/** The head a `sessions` row lists: title, working directory, start time and latest activity across its tables. */
export function dimHeadOf(path: string, row: DimSessionRowValue, sizeBytes: number, mtimeMs: number): SessionHead {
  const startedAt = iso(row.createdAt);
  const lastAt = Math.max(
    iso(row.updatedAt),
    iso(row.latestMessageUpdatedAt),
    iso(row.latestMessageCreatedAt),
    iso(row.latestLedgerCreatedAt)
  );
  return definedFields({
    ref: { agent: DIM_ID, path, sessionId: row.sessionId },
    lastActiveAt: lastAt > 0 ? lastAt : mtimeMs,
    sizeBytes,
    ...(row.title !== undefined && row.title !== "" ? { title: row.title.slice(0, SESSION_TITLE_MAX) } : {}),
    ...(row.cwd !== "" ? { cwd: row.cwd } : {}),
    ...(startedAt > 0 ? { startedAt } : {})
  });
}

function translate(
  rows: {
    session: DimSessionRowValue;
    messages: DimMessageValue[];
    ledger: (DimLedgerRowValue & { readonly rowid: number })[];
    runDurations: ReadonlyMap<string, number>;
    messageCount: number;
  },
  dbPath: string
): ParsedTranscript {
  const events: TranscriptEvent[] = [];
  const skipped: SkippedRecord[] = [];
  const session: TranscriptSession = definedFields({
    id: rows.session.sessionId,
    ...(rows.session.title !== undefined && rows.session.title !== ""
      ? { title: rows.session.title.slice(0, SESSION_TITLE_MAX) }
      : {}),
    ...(rows.session.cwd !== "" ? { cwd: rows.session.cwd } : {}),
    ...(iso(rows.session.createdAt) > 0 ? { startedAt: iso(rows.session.createdAt) } : {}),
    ...(iso(rows.session.updatedAt) > 0 ? { endedAt: iso(rows.session.updatedAt) } : {})
  });

  for (const message of rows.messages) {
    for (const [index, part] of message.parts.entries()) {
      // The source names the message's real database row and the part's index, and the event id carries that index,
      // so the parts of one message never share an identity.
      const partSource = definedFields({
        ...source(dbPath, "messages", "parts", message.rowid, message.rowid),
        id: `${message.rowid}:${index}`
      });
      const startedAt = iso(part.startTime);
      const ts = startedAt > 0 ? startedAt : message.createdAt;
      if (part.type === "text" && part.text !== undefined) {
        if (message.role === "user") {
          events.push(
            baseEvent(
              { ...partSource, value: message.rawParts },
              "user",
              { text: part.text, ...(message.runId !== undefined ? { runId: message.runId } : {}) },
              definedFields({ ts, id: `${message.rowid}:${index}` })
            )
          );
        } else if (message.role === "assistant") {
          events.push(
            baseEvent(
              { ...partSource, value: message.rawParts },
              "assistant",
              { text: part.text, ...(message.runId !== undefined ? { runId: message.runId } : {}) },
              definedFields({ ts, id: `${message.rowid}:${index}` })
            )
          );
        } else {
          skipped.push({ reason: `message-role:${message.role}`, source: partSource });
        }
      } else if (part.type === "reasoning" && part.text !== undefined && message.role === "assistant") {
        events.push(
          baseEvent(
            { ...partSource, value: message.rawParts },
            "reasoning",
            { text: part.text, ...(message.runId !== undefined ? { runId: message.runId } : {}) },
            definedFields({ ts, id: `${message.rowid}:${index}` })
          )
        );
      } else {
        skipped.push({ reason: `part:${part.type}`, source: partSource });
      }
    }
  }
  // The store records each run's usage in the append-only ledger; the transcript shows one request per row, so the
  // transcript and the usage decoder agree on the same totals. Run durations live once per run in `usage_run_stats`,
  // so attach each run's duration to its first settled ledger row to avoid double-counting.
  const consumedRuns = new Set<string>();
  for (const row of rows.ledger) {
    const usage = dimLedgerUsage(row.usage);
    let ledgerJson: unknown;
    try {
      ledgerJson = JSON.parse(row.usage ?? "") as unknown;
    } catch {
      ledgerJson = undefined;
    }
    if (usage === undefined) {
      continue;
    }
    const durationMs = takeRunDuration(row.runId, rows.runDurations, consumedRuns);
    // One request per settled usage event: the ledger row is its identity (a run can settle more than one), and
    // the run stays in the payload as the response id.
    events.push(
      baseEvent(
        {
          ...source(dbPath, "usage_ledger", "usage", row.rowid, rows.messageCount + row.rowid),
          value: ledgerJson
        },
        "request",
        {
          granularity: "turn",
          requestId: row.ledgerId,
          ...(row.runId !== undefined ? { responseId: row.runId } : {}),
          ...(row.modelId !== undefined ? { model: row.modelId } : {}),
          ...(row.providerId !== undefined ? { provider: row.providerId } : {}),
          usage,
          ...(durationMs !== undefined ? { durationMs } : {}),
          ...(row.cost !== undefined && row.cost !== null ? { costUsd: row.cost } : {})
        },
        { ts: iso(row.createdAt) }
      )
    );
  }
  markOrphanToolResults(events);
  assignSeq(events);
  return { events, skipped, session, agents: [{ id: DIM_ID }] };
}

function parsedSessionId(ref: SessionRef): string {
  return ref.sessionId ?? "";
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
      const rows = database
        .prepare(
          "SELECT s.rowid, s.sessionId, s.cwd, s.title, s.status, s.createdAt, s.updatedAt, " +
            "(SELECT MAX(m.updatedAt) FROM messages m WHERE m.sessionId = s.sessionId) AS latestMessageUpdatedAt, " +
            "(SELECT MAX(m.createdAt) FROM messages m WHERE m.sessionId = s.sessionId) AS latestMessageCreatedAt, " +
            "(SELECT MAX(l.createdAt) FROM usage_ledger l WHERE l.sessionId = s.sessionId) AS latestLedgerCreatedAt " +
            "FROM sessions s ORDER BY s.updatedAt"
        )
        .all();
      for (const row of rows) {
        signal?.throwIfAborted();
        const parsed = sessionRowOf(row);
        if (parsed === undefined) {
          continue;
        }
        yield dimHeadOf(path, parsed, info.size, info.mtimeMs);
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
      const sessionRow = database
        .prepare("SELECT rowid, sessionId, cwd, title, status, createdAt, updatedAt FROM sessions WHERE sessionId = ?")
        .get(ref.sessionId ?? "");
      const parsedSession = sessionRow === undefined ? undefined : sessionRowOf(sessionRow);
      if (parsedSession === undefined) {
        return err({ _tag: "SessionNotFound", path: ref.path });
      }
      const messageRows = database
        .prepare(
          "SELECT rowid, messageId, role, parts, metadata, orderKey, createdAt, updatedAt FROM messages WHERE sessionId = ? ORDER BY orderKey"
        )
        .all(parsedSession.sessionId);
      const messages: DimMessageValue[] = [];
      for (const row of messageRows as Record<string, unknown>[]) {
        const message = dimMessageOf(row, Number(row.rowid));
        if (message !== undefined) {
          messages.push(message);
        }
      }
      const ledgerRows = database
        .prepare(
          "SELECT rowid, ledgerId, sessionId, runId, providerId, modelId, usage, cost, createdAt FROM usage_ledger WHERE sessionId = ? ORDER BY createdAt, rowid"
        )
        .all(parsedSession.sessionId);
      const ledger: (DimLedgerRowValue & { readonly rowid: number })[] = [];
      for (const row of ledgerRows as Record<string, unknown>[]) {
        const parsed = dimLedgerRowOf(row);
        if (parsed !== undefined) {
          ledger.push({ ...parsed, rowid: Number(row.rowid) });
        }
      }
      const runDurations = readRunDurations(database, parsedSession.sessionId);
      const translated = translate(
        { session: parsedSession, messages, ledger, runDurations, messageCount: messages.length },
        ref.path
      );
      options.signal?.throwIfAborted();
      return ok(createTranscript(DIM_ID, dimCapabilities(translated.events), translated));
    });
  },
  summarize: (platform, ref, options = {}) =>
    withDimDatabase(platform, ref.path, options.signal, (database) => {
      const sessionId = parsedSessionId(ref);
      const sessionRow = database.prepare("SELECT rowid FROM sessions WHERE sessionId = ?").get(sessionId);
      if (sessionRow === undefined) {
        return err({ _tag: "SessionNotFound", path: ref.path });
      }
      // A paged pass over the tables, keeping only the running numbers: the state grows with the session's
      // requests, never with its bytes. The totals match the fold of the loaded transcript — the requests come
      // from the same ledger rows in the same order.
      const totals = emptyTotals();
      const prompts = emptyPrompts(options.prompts);
      const seen = new Set<Capability>();
      const runDurations = readRunDurations(database, sessionId);
      const consumedRuns = new Set<string>();
      const PAGE = 500;
      for (let offset = 0; ; offset += PAGE) {
        options.signal?.throwIfAborted();
        const rows = database
          .prepare("SELECT messageId, role, parts FROM messages WHERE sessionId = ? ORDER BY orderKey LIMIT ? OFFSET ?")
          .all(sessionId, PAGE, offset);
        for (const row of rows as Record<string, unknown>[]) {
          const message = dimMessageOf(row, 0);
          if (message === undefined) {
            continue;
          }
          if (message.role === "assistant") {
            if (message.parts.some((part) => part.type === "reasoning" && part.text !== undefined)) {
              seen.add("reasoning");
            }
            continue;
          }
          if (message.role !== "user") {
            continue;
          }
          const texts = message.parts
            .filter((part) => part.type === "text" && part.text !== undefined)
            .map((part) => part.text)
            .join("\n\n");
          if (texts === "") {
            continue;
          }
          totals.turns += 1;
          prompts.add(texts);
        }
        if (rows.length < PAGE) {
          break;
        }
      }
      for (let offset = 0; ; offset += PAGE) {
        options.signal?.throwIfAborted();
        const rows = database
          .prepare(
            "SELECT runId, usage FROM usage_ledger WHERE sessionId = ? ORDER BY createdAt, rowid LIMIT ? OFFSET ?"
          )
          .all(sessionId, PAGE, offset);
        for (const row of rows as Record<string, unknown>[]) {
          const usage = dimLedgerUsage(typeof row.usage === "string" ? row.usage : undefined);
          if (usage !== undefined) {
            seen.add("requests");
            seen.add("usage");
            addRequest(totals, usage);
            const runId = typeof row.runId === "string" ? row.runId : undefined;
            const durationMs = takeRunDuration(runId, runDurations, consumedRuns);
            if (durationMs !== undefined) {
              seen.add("durations");
              addRequestDuration(totals, durationMs);
            }
          }
        }
        if (rows.length < PAGE) {
          break;
        }
      }
      const capabilities = DIM_SESSION_CAPABILITIES.filter((capability) => seen.has(capability));
      return ok(finishPass(totals, capabilities, 0, prompts.list));
    })
};
