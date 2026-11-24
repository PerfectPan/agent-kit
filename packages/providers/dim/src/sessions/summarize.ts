import { definedFields } from "@rivus/agent-kit-catalog/spi";
import {
  addRequest,
  addRequestDuration,
  emptyPrompts,
  emptyTotals,
  finishPass,
  type Capability,
  type SessionPromptsOptions,
  type SessionSummaryWithPrompts,
  type SqliteDatabase
} from "@rivus/agent-kit-sessions/spi";
import { dimLedgerUsage } from "../records.js";
import { DIM_SESSION_CAPABILITIES } from "./capabilities.js";
import { dimPartSteps } from "./events.js";
import {
  dimCheckpoints,
  dimForkFilter,
  dimLedgerPage,
  dimMessagePage,
  dimRunDurations,
  dimSessionRow,
  dimSubagentRelations,
  dimTakeRunDuration,
  isForkedCheckpoint,
  isForkedLedgerRow,
  isForkedMessage,
  type DimForkFilter
} from "./store.js";

// Rows per page: the summarize pass reads a table in pages and keeps only the running numbers, so its state grows with
// the session's requests, turns and subagents, never with its bytes.
const PAGE = 500;

/** One lane's rows into the running numbers: its message rows in pages, its ledger rows in pages, its checkpoints. */
function summarizeDimLane(
  database: SqliteDatabase,
  sessionId: string,
  main: boolean,
  forkFilter: DimForkFilter | undefined,
  totals: ReturnType<typeof emptyTotals>,
  sink: ReturnType<typeof emptyPrompts>,
  seen: Set<Capability>,
  signal: AbortSignal | undefined
): void {
  for (let offset = 0; ; offset += PAGE) {
    signal?.throwIfAborted();
    const rows = dimMessagePage(database, sessionId, PAGE, offset);
    for (const row of rows) {
      const message = row.value;
      if (message === undefined || (forkFilter !== undefined && isForkedMessage(message, forkFilter))) {
        continue;
      }
      let starts = 0;
      const texts: string[] = [];
      for (const step of dimPartSteps(message)) {
        if ("skip" in step) {
          continue;
        }
        const body = step.body;
        if (body.kind === "reasoning") {
          seen.add("reasoning");
        } else if (body.kind === "tool_result" && body.payload.isError === true) {
          totals.failedTools += 1;
        } else if (main && body.kind === "user") {
          starts += 1;
          const text = body.payload.text?.trim() ?? "";
          if (text !== "") {
            texts.push(text);
          }
        }
      }
      // One turn per user row of the main lane that starts one; its prompt is the row's texts, each trimmed, as
      // `sessionPrompts` joins them. A failed tool result counts on every lane.
      if (starts > 0) {
        totals.turns += 1;
      }
      if (texts.length > 0) {
        sink.add(texts.join("\n\n"));
      }
    }
    if (rows.length < PAGE) {
      break;
    }
  }
  const runDurations = dimRunDurations(database, sessionId);
  const consumedRuns = new Set<string>();
  for (let offset = 0; ; offset += PAGE) {
    signal?.throwIfAborted();
    const rows = dimLedgerPage(database, sessionId, PAGE, offset);
    for (const row of rows) {
      if (forkFilter !== undefined && isForkedLedgerRow(row, forkFilter)) {
        continue;
      }
      const usage = dimLedgerUsage(row.usage);
      if (usage === undefined) {
        continue;
      }
      seen.add("requests");
      seen.add("usage");
      // The billed fields of the request event `translateDimLane` gives the row.
      addRequest(totals, definedFields({ granularity: "turn" as const, model: row.modelId, usage }));
      const durationMs = dimTakeRunDuration(row.runId, runDurations, consumedRuns);
      if (durationMs !== undefined) {
        seen.add("durations");
        addRequestDuration(totals, durationMs);
      }
    }
    if (rows.length < PAGE) {
      break;
    }
  }
  for (const checkpoint of dimCheckpoints(database, sessionId)?.checkpoints ?? []) {
    if (forkFilter !== undefined && isForkedCheckpoint(checkpoint, forkFilter)) {
      continue;
    }
    totals.compactions += 1;
    seen.add("compaction");
    if (checkpoint.preTokens !== undefined || checkpoint.postTokens !== undefined) {
      seen.add("compactionTokens");
    }
  }
}

interface DimSummaryLane {
  readonly sessionId: string;
  readonly sourceSessionId?: string;
  readonly createdAt: number;
  readonly forkContext?: string;
}

/**
 * The summary of one session and the subagents its relations name, from the tables and without a transcript: each
 * lane's message rows, then its ledger rows, in the order `load` lays the lanes out. Both passes read the same rows
 * by the same rules, so the numbers, the prompts and `requestUsage` equal the fold of the loaded transcript.
 */
export function summarizeDimSession(
  database: SqliteDatabase,
  sessionId: string,
  prompts: SessionPromptsOptions | undefined,
  signal: AbortSignal | undefined
): SessionSummaryWithPrompts {
  const totals = emptyTotals();
  const sink = emptyPrompts(prompts);
  const seen = new Set<Capability>();
  let subagents = 0;
  const queue: DimSummaryLane[] = [{ sessionId, createdAt: 0 }];
  const visited = new Set([sessionId]);
  for (let lane = queue.shift(); lane !== undefined; lane = queue.shift()) {
    signal?.throwIfAborted();
    // A subagent whose session row is gone is an unavailable lane in the loaded transcript; stop that branch here.
    const row = dimSessionRow(database, lane.sessionId);
    if (row === undefined) {
      continue;
    }
    const forkFilter =
      lane.forkContext === "all" && lane.sourceSessionId !== undefined
        ? dimForkFilter(database, lane.sourceSessionId, row.createdAt, lane.createdAt)
        : undefined;
    summarizeDimLane(database, lane.sessionId, lane.sessionId === sessionId, forkFilter, totals, sink, seen, signal);
    for (const relation of dimSubagentRelations(database, lane.sessionId)) {
      if (visited.has(relation.targetSessionId)) {
        continue;
      }
      visited.add(relation.targetSessionId);
      subagents += 1;
      queue.push({
        sessionId: relation.targetSessionId,
        sourceSessionId: relation.sourceSessionId,
        createdAt: relation.createdAt,
        ...(relation.forkContext === undefined ? {} : { forkContext: relation.forkContext })
      });
    }
  }
  if (subagents > 0) {
    seen.add("subagents");
  }
  return finishPass(
    totals,
    DIM_SESSION_CAPABILITIES.filter((capability) => seen.has(capability)),
    subagents,
    sink.list
  );
}
