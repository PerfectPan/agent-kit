/**
 * The per-turn model calls joined from the two context files a Grok session keeps beside `updates.jsonl`:
 * `events.jsonl` draws the call boundaries (`loop_started`, `first_token` under `turn_started`), and
 * `chat_history.jsonl` names each call's model (the `assistant` entries after a `user` entry's `prompt_index`).
 * Grok records usage per turn only, so the join names calls; it never invents per-call usage.
 */

import * as z from "zod/mini";

import { lenient, logTimestamp, timeOf } from "@rivus/agent-kit-sessions/spi";

export interface GrokCall {
  /** The call's response start, its `first_token` (else its `loop_started`), in epoch ms. */
  ts: number | undefined;
  /** The model the call's assistant entry named. */
  model: string | undefined;
  /**
   * The ids of the tool calls the call made, from the `tool_completed` records of its loop; `undefined` when the
   * event log has no loop for the call. A response may stream a tool call after an earlier one's result, so these
   * ids, not the result order, say which call a tool call belongs to.
   */
  toolCallIds: readonly string[] | undefined;
}

export interface GrokSessionCalls {
  /** The calls of each turn, keyed by the turn number `turn_started` wrote (the prompt index `updates.jsonl` tracks). */
  readonly turns: ReadonlyMap<number, readonly GrokCall[]>;
}

/** The `events.jsonl` fields the join reads. Strip mode keeps no other key of a record. */
const EventRecord = z.object({
  type: lenient(z.string()),
  ts: logTimestamp,
  turn_number: lenient(z.number()),
  tool_call_id: lenient(z.string())
});

/** The `chat_history.jsonl` fields the join reads; the entries' content is never kept. */
const HistoryRecord = z.object({
  type: lenient(z.string()),
  prompt_index: lenient(z.number()),
  model_id: lenient(z.string())
});

/**
 * One loop of a turn: the `loop_started` a `first_token` may complete. `first_token` records carry no index, so a
 * token closes the turn's latest loop — the loop whose response is streaming.
 */
interface Loop {
  startedTs: number | undefined;
  firstTokenTs: number | undefined;
  toolCallIds: string[];
}

/**
 * The loops each turn ran, from the event log alone, each with the first `first_token` a token record gave it and
 * the tool calls it completed. A loop whose response never streamed keeps only its start.
 */
async function loopsFromEvents(records: AsyncIterable<{ value: unknown }>): Promise<Map<number, Loop[]>> {
  const turns = new Map<number, Loop[]>();
  let loops: Loop[] | undefined;
  for await (const record of records) {
    const event = z.safeParse(EventRecord, record.value).data;
    if (event?.type === "turn_started") {
      const number = event.turn_number;
      loops = number === undefined ? undefined : (turns.get(number) ?? []);
      if (number !== undefined && loops !== undefined) {
        turns.set(number, loops);
      }
      continue;
    }
    if (loops === undefined) {
      continue;
    }
    if (event?.type === "loop_started") {
      loops.push({ startedTs: timeOf(event.ts), firstTokenTs: undefined, toolCallIds: [] });
    } else if (event?.type === "first_token") {
      const open = loops.at(-1);
      if (open !== undefined && open.firstTokenTs === undefined) {
        open.firstTokenTs = timeOf(event.ts);
      }
    } else if (event?.type === "tool_completed" && event.tool_call_id !== undefined) {
      loops.at(-1)?.toolCallIds.push(event.tool_call_id);
    }
  }
  return turns;
}

/**
 * The model of each turn's calls, from the chat history's `assistant` entries under a numbered prompt; an entry
 * that names no model is `undefined`. A `user` entry without a `prompt_index`, such as a reminder the CLI adds
 * within a turn, keeps the turn going; a prompt index the history already holds starts no second turn.
 */
async function modelsFromHistory(
  records: AsyncIterable<{ value: unknown }>
): Promise<Map<number, (string | undefined)[]>> {
  const turns = new Map<number, (string | undefined)[]>();
  let models: (string | undefined)[] | undefined;
  for await (const record of records) {
    const entry = z.safeParse(HistoryRecord, record.value).data;
    if (entry?.type === "user") {
      const index = entry.prompt_index;
      if (index !== undefined) {
        models = turns.has(index) ? undefined : [];
        if (models !== undefined) {
          turns.set(index, models);
        }
      }
      continue;
    }
    if (entry?.type === "assistant" && models !== undefined) {
      models.push(entry.model_id === "" ? undefined : entry.model_id);
    }
  }
  return turns;
}

/**
 * The join, or `undefined` when no turn names a second call: the assistant entries are the calls (they name the
 * model), each timed by its event log loop. A turn whose counts disagree keeps the entries; a turn the chat history
 * never reached, or reached without an assistant entry, keeps the loops alone. A single-call join is `undefined` so the translation keeps its turn-level
 * request unchanged. The records stream: the join holds a few numbers per call, never a file's text.
 */
export async function grokCallsOf(
  events: AsyncIterable<{ value: unknown }>,
  history: AsyncIterable<{ value: unknown }>
): Promise<GrokSessionCalls | undefined> {
  const loopsByTurn = await loopsFromEvents(events);
  const modelsByTurn = await modelsFromHistory(history);
  const turns = new Map<number, readonly GrokCall[]>();
  for (const [turn, models] of modelsByTurn) {
    if (models.length === 0) {
      continue;
    }
    const loops = loopsByTurn.get(turn) ?? [];
    turns.set(
      turn,
      models.map((model, index) => {
        const loop = loops[index];
        return loop === undefined
          ? { ts: undefined, model, toolCallIds: undefined }
          : { ts: loop.firstTokenTs ?? loop.startedTs, model, toolCallIds: loop.toolCallIds };
      })
    );
  }
  for (const [turn, loops] of loopsByTurn) {
    if (!turns.has(turn) && loops.length > 1) {
      turns.set(
        turn,
        loops.map((loop) => ({
          ts: loop.firstTokenTs ?? loop.startedTs,
          model: undefined,
          toolCallIds: loop.toolCallIds
        }))
      );
    }
  }
  if (![...turns.values()].some((calls) => calls.length > 1)) {
    return undefined;
  }
  return { turns };
}
