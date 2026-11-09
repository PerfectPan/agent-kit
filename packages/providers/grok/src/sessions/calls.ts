/**
 * The per-turn model calls joined from the two context files a Grok session keeps beside `updates.jsonl`:
 * `events.jsonl` draws the call boundaries (`loop_started`, `first_token` under `turn_started`), and
 * `chat_history.jsonl` names each call's model (the `assistant` entries after a `user` entry's `prompt_index`).
 * Grok records usage per turn only, so the join names calls; it never invents per-call usage.
 */

import { timeOf } from "@rivus/agent-kit-sessions/spi";

export interface GrokCall {
  /** The call's response start, its `first_token` (else its `loop_started`), in epoch ms. */
  ts?: number;
  /** The model the call's assistant entry named. */
  model?: string;
}

export interface GrokSessionCalls {
  /** The calls of each turn, keyed by the turn number `turn_started` wrote (the prompt index `updates.jsonl` tracks). */
  readonly turns: ReadonlyMap<number, readonly GrokCall[]>;
}

/** A parsed line the join reads, or `undefined` when the line is not JSON. */
function jsonLine(text: string | undefined): unknown[] {
  if (text === undefined) {
    return [];
  }
  const out: unknown[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }
    try {
      out.push(JSON.parse(trimmed) as unknown);
    } catch {
      // A torn or foreign line joins nothing; the rest of the file still does.
    }
  }
  return out;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** The record's time field, which the event log writes as an ISO string or epoch seconds. */
function timeField(value: unknown): number | undefined {
  return typeof value === "string" || typeof value === "number" ? timeOf(value) : undefined;
}

/**
 * One open loop: the `loop_started` a `first_token` may complete. `first_token` records carry no index, so a
 * token closes the turn's still-open loop — the loop whose response is streaming.
 */
interface OpenLoop {
  startedTs?: number;
  firstTokenTs?: number;
}

/**
 * The calls each turn ran, from the event log alone: the turn's open loops, in order, each with the first
 * `first_token` a token record gave it. A loop whose response never streamed keeps only its start.
 */
function callsFromEvents(records: readonly unknown[]): Map<number, OpenLoop[]> {
  const turns = new Map<number, OpenLoop[]>();
  let turn: number | undefined;
  for (const record of records) {
    if (typeof record !== "object" || record === null) {
      continue;
    }
    const value = record as Record<string, unknown>;
    const type = str(value.type);
    if (type === "turn_started") {
      const number = num(value.turn_number);
      if (number !== undefined && !turns.has(number)) {
        turns.set(number, []);
      }
      turn = number;
      continue;
    }
    if (turn === undefined) {
      continue;
    }
    const loops = turns.get(turn)!;
    if (type === "loop_started") {
      loops.push({ startedTs: timeField(value.ts) });
      continue;
    }
    if (type === "first_token") {
      const open = loops[loops.length - 1];
      if (open !== undefined && open.firstTokenTs === undefined) {
        open.firstTokenTs = timeField(value.ts);
      }
    }
  }
  return turns;
}

/** The model of each turn's calls, from the chat history's `assistant` entries under a numbered prompt. */
function modelsFromChatHistory(records: readonly unknown[]): Map<number, string[]> {
  const turns = new Map<number, string[]>();
  let turn: number | undefined;
  for (const record of records) {
    if (typeof record !== "object" || record === null) {
      continue;
    }
    const value = record as Record<string, unknown>;
    if (value.type === "user") {
      const index = num(value.prompt_index);
      turn = index !== undefined && !turns.has(index) ? index : undefined;
      continue;
    }
    if (value.type === "assistant" && turn !== undefined) {
      const model = str(value.model_id);
      const models = turns.get(turn) ?? [];
      if (turns.get(turn) === undefined) {
        turns.set(turn, models);
      }
      models.push(model ?? "");
    }
  }
  return turns;
}

/**
 * The join, or `undefined` when neither file names a second call: the assistant entries are the calls (they name
 * the model), each timed by its event log loop. A turn whose counts disagree keeps the entries; a turn the chat
 * history never reached keeps the loops alone. A single-call join is `undefined` so the translation keeps its
 * turn-level request unchanged.
 */
export function grokCallsOf(
  eventsText: string | undefined,
  historyText: string | undefined
): GrokSessionCalls | undefined {
  const loopsByTurn = callsFromEvents(jsonLine(eventsText));
  const modelsByTurn = modelsFromChatHistory(jsonLine(historyText));
  const turns = new Map<number, readonly GrokCall[]>();
  for (const [turn, models] of modelsByTurn) {
    const loops = loopsByTurn.get(turn) ?? [];
    const calls: GrokCall[] = [];
    for (let index = 0; index < models.length; index++) {
      const loop = loops[index];
      const model = models[index];
      calls.push({
        ...(loop === undefined ? {} : { ts: loop.firstTokenTs ?? loop.startedTs }),
        ...(model === "" ? {} : { model })
      });
    }
    turns.set(turn, calls);
  }
  for (const [turn, loops] of loopsByTurn) {
    if (!turns.has(turn) && loops.length > 1) {
      turns.set(
        turn,
        loops.map((loop) => ({ ts: loop.firstTokenTs ?? loop.startedTs }))
      );
    }
  }
  if (![...turns.values()].some((calls) => calls.length > 1)) {
    return undefined;
  }
  return { turns };
}
