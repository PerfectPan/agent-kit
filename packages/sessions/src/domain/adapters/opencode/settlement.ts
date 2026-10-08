import { asNumber, asRecord, asString } from "../../protocols/record-fields.js";
import type { UsageRecord } from "../../usage/index.js";
import { rememberKey } from "../usage-lines.js";
import { opencodeMessageUsage } from "./usage.js";

/** A message runs far shorter than this, so a row created this long before `since` holds no record to keep. */
export const LONGEST_MESSAGE_MS: number = 24 * 60 * 60 * 1000;

/** How many running messages a cursor remembers; one that never finishes is dropped once newer ones push it out. */
export const RUNNING_IDS: number = 64;

const REPORTED_IDS = 256;

/** The `time_updated` a query may start at: a day before `since`, since a message created before it can still end inside the window. */
export function opencodeQueryFloor(since: number | undefined): number {
  return since === undefined ? 0 : since - LONGEST_MESSAGE_MS;
}

/** One row of opencode's `message` table, as the settlement rules read it. */
export interface OpencodeTableRow {
  readonly id: string;
  /** The row's position in the table, which a record's source line keeps. */
  readonly row: number;
  /** When the row was last updated, which the pages of a continuing scan follow. */
  readonly updated: number;
  /** The row's `time_created` as a number; a final decode reports an unfinished message at it. */
  readonly created: number;
  readonly sessionId?: string;
  /** The row's `data` column; a message whose data is not JSON is skipped. */
  readonly data: string;
}

/** Where a decode of the database stopped, as plain JSON data for the cursor to carry. */
export interface OpencodeSettlementState {
  /** The latest row read: when it was last updated, and its id. Later decodes read the rows changed after it. */
  updated: number;
  id: string;
  /** While the first read goes by row id: the last row id read. */
  row?: number;
  /** Assistant messages that were running when read; a final decode reports those that never finished. */
  running: string[];
  /** Messages reported last, newest last: a message that changes after it finished is read again. */
  reported: string[];
}

/** Restores the settlement state a cursor carries, reading only the fields it understands. */
function restoreOpencodeSettlement(saved: unknown): OpencodeSettlementState {
  const state = asRecord(saved);
  const ids = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  const row = asNumber(state?.row);
  return {
    updated: asNumber(state?.updated) ?? 0,
    id: asString(state?.id) ?? "",
    ...(row === undefined ? {} : { row }),
    running: ids(state?.running),
    reported: ids(state?.reported)
  };
}

/** When opencode's messages count as usage, over the rows the queries feed it. */
export interface OpencodeSettlement {
  /** Where the next page starts: by row id during the first pass (`row`), else from the newest change seen. */
  position(): { readonly row?: number; readonly updated: number; readonly id: string };
  /** Ends the first pass by row id; the pages that follow go by the newest change. */
  endByRow(): void;
  /**
   * Settles one page of rows in order and returns the messages it reports. A running message is only remembered (its
   * counts may still grow); a finished one reports once, the newest ones remembered first.
   */
  push(rows: readonly OpencodeTableRow[]): UsageRecord[];
  /** The messages that were running when the pages were read, for the final look at them. */
  runningIds(): readonly string[];
  /**
   * The final look: a running message whose row is gone was deleted; the rest report at their creation time, like
   * presence counts them. The rows it re-fetches by id do not move the position: the pages that follow still go by
   * the newest change the page reads saw.
   */
  end(rows: readonly OpencodeTableRow[]): UsageRecord[];
  /** The state as the cursor keeps it. */
  save(): OpencodeSettlementState;
}

/**
 * The settlement of one decode of opencode's database, from the state a previous decode saved. The first read of a
 * database goes by row id, one pass over the table; a continuing one reads the rows changed after the newest change
 * the previous read saw.
 */
export function createOpencodeSettlement(
  path: string,
  options: { readonly state?: unknown; readonly final: boolean }
): OpencodeSettlement {
  const state = restoreOpencodeSettlement(options.state);
  if (state.updated === 0 && state.id === "") {
    state.row ??= 0;
  }
  const messageOf = (row: OpencodeTableRow): UsageRecord | "running" | undefined => {
    let value: unknown;
    try {
      value = JSON.parse(row.data) as unknown;
    } catch {
      return undefined;
    }
    return opencodeMessageUsage(value, {
      id: row.id,
      ...(row.sessionId === undefined ? {} : { sessionId: row.sessionId }),
      source: { file: path, offset: 0, length: 0, line: row.row },
      ...(options.final ? { settledAt: row.created } : {})
    });
  };
  const settle = (row: OpencodeTableRow, out: UsageRecord[]): void => {
    const message = messageOf(row);
    if (message === "running") {
      if (!state.running.includes(row.id)) {
        rememberKey(state.running, row.id, RUNNING_IDS);
      }
      return;
    }
    state.running = state.running.filter((running) => running !== row.id);
    if (message && !state.reported.includes(row.id)) {
      rememberKey(state.reported, row.id, REPORTED_IDS);
      out.push(message);
    }
  };
  const push = (rows: readonly OpencodeTableRow[]): UsageRecord[] => {
    const out: UsageRecord[] = [];
    for (const row of rows) {
      if (state.row !== undefined) {
        state.row = row.row;
        if (row.updated > state.updated || (row.updated === state.updated && row.id > state.id)) {
          state.updated = row.updated;
          state.id = row.id;
        }
      } else {
        state.updated = row.updated;
        state.id = row.id;
      }
      settle(row, out);
    }
    return out;
  };
  return {
    position: () => ({ ...(state.row === undefined ? {} : { row: state.row }), updated: state.updated, id: state.id }),
    endByRow: () => {
      delete state.row;
    },
    push,
    runningIds: () => [...state.running],
    end(rows) {
      // Only once the query has answered: a running message whose row is gone was deleted.
      const present = new Set(rows.map((row) => row.id));
      state.running = state.running.filter((id) => present.has(id));
      const out: UsageRecord[] = [];
      for (const row of rows) {
        settle(row, out);
      }
      return out;
    },
    save: () => structuredClone(state)
  };
}
