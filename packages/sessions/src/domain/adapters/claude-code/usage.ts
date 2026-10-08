import { err, ok } from "@rivus/agent-kit-catalog";

import { timeOf, unknownFormatGeneration } from "../../transcript/index.js";
import { compactUsage, shortHash, type Usage, type UsageRecord } from "../../usage/index.js";
import { asNumber, asRecord, asString } from "../../protocols/record-fields.js";
import { rememberKey, type UsageFile, type UsageLineDecoder } from "../usage-lines.js";

const AGENT = "claude-code";

/**
 * The Usage of one assistant message's `usage` object. Claude Code reports `input_tokens` without the cache, so
 * cache reads and writes are added back; without `input_tokens` the total input is unknown, and only the cache counts
 * that are present remain. When the log has the `cache_creation` breakdown by TTL, it is the cache
 * write count: the flat `cache_creation_input_tokens` can be 0 while the one-hour bucket is not.
 */
export function claudeCodeUsage(value: unknown): Usage | undefined {
  const usage = asRecord(value);
  if (!usage) {
    return undefined;
  }
  const input = asNumber(usage.input_tokens);
  const cacheRead = asNumber(usage.cache_read_input_tokens);
  const byTtl = asRecord(usage.cache_creation);
  const write5m = asNumber(byTtl?.ephemeral_5m_input_tokens);
  const write1h = asNumber(byTtl?.ephemeral_1h_input_tokens);
  const cacheWrite =
    write5m !== undefined || write1h !== undefined
      ? (write5m ?? 0) + (write1h ?? 0)
      : asNumber(usage.cache_creation_input_tokens);
  return compactUsage({
    inputTokens: input === undefined ? undefined : input + (cacheRead ?? 0) + (cacheWrite ?? 0),
    outputTokens: asNumber(usage.output_tokens),
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    cacheWrite1hTokens: write1h,
    reasoningTokens: asNumber(asRecord(usage.output_tokens_details)?.thinking_tokens)
  });
}

/** A record envelope this adapter knows: a string `type`, no `formatVersion`, a semver `version` when present. */
export function knownClaudeCodeGeneration(rec: Record<string, unknown>): boolean {
  if ("formatVersion" in rec || typeof rec.type !== "string") {
    return false;
  }
  const version = rec.version;
  return !(typeof version === "number" || (typeof version === "string" && !/^\d+\.\d+\.\d+/.test(version)));
}

/** The model id of a message Claude Code wrote itself, such as an API error, without calling a model. */
const SYNTHETIC_MODEL = "<synthetic>";

/**
 * The key of the model request a `user` or `assistant` record belongs to: its `requestId`. Behind an API gateway that
 * returns no request id, the message id is the key. A synthetic message has a message id but no request behind it.
 */
export function claudeCodeRequestKey(
  rec: Record<string, unknown>,
  message: Record<string, unknown>
): string | undefined {
  return asString(rec.requestId) ?? (message.model === SYNTHETIC_MODEL ? undefined : asString(message.id));
}

/**
 * The usage of a request that more than one record reports: the one with the most tokens, the later one on a tie.
 * Claude Code writes a record per content block while the response streams, each with the usage so far, so the last
 * record is normally the largest; a copied record with less usage does not replace it.
 */
export function claudeCodeRequestUsage(current: Usage | undefined, next: Usage | undefined): Usage | undefined {
  if (!current || !next) {
    return next ?? current;
  }
  const size = (usage: Usage): number => (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  return size(next) >= size(current) ? next : current;
}

/**
 * A request whose records may continue: Claude Code writes one record per content block of a response. It is kept in
 * the cursor, so it holds only what the file and the lane do not already tell.
 */
interface OpenRequest {
  /** The request id, else the message id. */
  key: string;
  /** The key is the message id: an API gateway returned no request id. */
  byMessage?: true;
  /** The message id, when it is not the key. */
  responseId?: string;
  model?: string;
  usage: Usage;
  timestamp: number;
  /** The session id when the file had named none yet where the request started. */
  sessionId?: string;
  /** Where the request's first record is in the file. */
  offset: number;
  length: number;
  line: number;
}

interface LaneState {
  /** The requests that may still get records, least recently touched first. */
  open: OpenRequest[];
  /** `shortHash`es of the keys of the requests reported last, newest last. */
  reported: string[];
}

interface ClaudeCodeUsageState {
  sessionId?: string;
  lastTime?: number;
  /** By lane id; the main agent's lane is `""`. */
  lanes: Record<string, LaneState>;
}

/**
 * How many requests a lane keeps open. A request's records follow each other, with the lane's tool results and
 * attachments between them, but a lane does not start another request in between in the logs we have read; up to this
 * many interleaved requests still get all their records.
 */
const OPEN_PER_LANE = 4;

/**
 * How many reported keys a lane remembers, in the cursor, so that a later record of a reported request is dropped. Such
 * records come only after more interleaved requests than a lane keeps open, or after a final decode.
 */
const REPORTED_PER_LANE = 8;

/**
 * Claude Code's usage over one session file, by the translator's rules: one record per request key, with the model and
 * message id of the request's last record and the usage that `claudeCodeRequestUsage` keeps. A request stays open,
 * and in the cursor, until its lane has started four newer requests or the file is final; only then is it
 * reported, so a decode that continues the file later gives the records a decode of the whole file gives. Records
 * without usage neither open nor touch a request. Unlike the translator, which reads the whole session, the decoder
 * drops records of a request reported already only while the lane remembers its key (the last 8): a copy after more
 * requests than that counts again. A subagent file can start with a copy of another subagent's records, so a total over
 * several files counts each `requestId` (else `responseId`) once, which `scanUsage` does.
 */
export function claudeCodeUsageLines(file: UsageFile, saved?: unknown): UsageLineDecoder {
  const state = restore(saved);
  const report = (laneId: string, lane: LaneState, open: OpenRequest): UsageRecord => {
    rememberKey(lane.reported, shortHash(open.key), REPORTED_PER_LANE);
    return requestRecord(open, {
      sessionId: open.sessionId ?? (state.sessionId || file.sessionId),
      file: file.path,
      ...(laneId ? { agentLaneId: laneId } : {})
    });
  };
  return {
    push(record) {
      const rec = asRecord(record.value);
      if (!rec || !knownClaudeCodeGeneration(rec)) {
        return err(unknownFormatGeneration(AGENT, record));
      }
      const ts = timeOf(rec.timestamp) ?? state.lastTime ?? file.mtimeMs;
      state.lastTime = ts;
      state.sessionId ||= asString(rec.sessionId);
      if (rec.type !== "user" && rec.type !== "assistant") {
        return ok([]);
      }
      const message = asRecord(rec.message) ?? {};
      const key = claudeCodeRequestKey(rec, message);
      if (!key) {
        return ok([]);
      }
      let laneId = asString(rec.agentId) ?? file.agentLaneId;
      if (rec.isSidechain === true) {
        laneId ??= "sidechain";
      }
      const laneKey = laneId ?? "";
      const lane = (state.lanes[laneKey] ??= { open: [], reported: [] });
      const usage = claudeCodeUsage(message.usage);
      const model = asString(message.model);
      const responseId = asString(message.id);
      const at = lane.open.findIndex((open) => open.key === key);
      if (at >= 0) {
        const [open] = lane.open.splice(at, 1);
        open!.usage = claudeCodeRequestUsage(open!.usage, usage) ?? open!.usage;
        open!.model = model || open!.model;
        if (responseId && responseId !== key) {
          open!.responseId = responseId;
        }
        lane.open.push(open!);
        return ok([]);
      }
      if (!usage || lane.reported.includes(shortHash(key))) {
        return ok([]);
      }
      lane.open.push({
        key,
        usage,
        timestamp: ts,
        offset: record.offset,
        length: record.length,
        line: record.line,
        ...(asString(rec.requestId) ? {} : { byMessage: true as const }),
        ...(responseId && responseId !== key ? { responseId } : {}),
        ...(model ? { model } : {}),
        ...(state.sessionId ? {} : { sessionId: file.sessionId })
      });
      return ok(lane.open.length > OPEN_PER_LANE ? [report(laneKey, lane, lane.open.shift()!)] : []);
    },
    end(final) {
      if (!final) {
        return [];
      }
      return Object.entries(state.lanes).flatMap(([laneId, lane]) =>
        lane.open.splice(0).map((open) => report(laneId, lane, open))
      );
    },
    save() {
      return structuredClone(state);
    }
  };
}

function requestRecord(
  open: OpenRequest,
  where: { readonly sessionId: string; readonly file: string; readonly agentLaneId?: string }
): UsageRecord {
  const record: UsageRecord = {
    agent: AGENT,
    sessionId: where.sessionId,
    granularity: "request",
    timestamp: open.timestamp,
    usage: open.usage,
    source: { file: where.file, offset: open.offset, length: open.length, line: open.line }
  };
  if (where.agentLaneId) {
    record.agentLaneId = where.agentLaneId;
  }
  if (!open.byMessage) {
    record.requestId = open.key;
  }
  const responseId = open.byMessage ? open.key : open.responseId;
  if (responseId) {
    record.responseId = responseId;
  }
  if (open.model) {
    record.model = open.model;
  }
  return record;
}

/** A saved state is the decoder's own output, passed back through a cursor; a missing field starts empty. */
function restore(saved: unknown): ClaudeCodeUsageState {
  const state = asRecord(saved);
  const sessionId = asString(state?.sessionId);
  const lastTime = asNumber(state?.lastTime);
  return {
    lanes: structuredClone(asRecord(state?.lanes) ?? {}) as Record<string, LaneState>,
    ...(sessionId ? { sessionId } : {}),
    ...(lastTime === undefined ? {} : { lastTime })
  };
}

/**
 * The key under which a scan counts a request once in its window. Claude Code copies a request's records into other
 * files (a resumed subagent's file starts with a copy of another's records), and a request id is Anthropic's, unique
 * everywhere, so it is the key across sessions. Behind an API gateway that returns no request id, the message id is
 * only as unique as the gateway makes it, so it counts within its session.
 */
export function claudeCodeUsageKey(record: UsageRecord): string | undefined {
  if (record.requestId) {
    return record.requestId;
  }
  return record.responseId === undefined ? undefined : `${record.sessionId} ${record.responseId}`;
}
