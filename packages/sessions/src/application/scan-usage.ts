import { AgentKitError, type CodingAgentId, parseCodingAgentId } from "@rivus/agent-kit-catalog";
import type { Platform } from "@rivus/agent-kit-platform";

import type { UsageRecord } from "../domain/usage/index.js";
import { SHORT_HASH_LENGTH, shortHash } from "../agents/usage-lines.js";
import { decodeUsage, isUsageRecord, isUsageSource, listUsageSources } from "./decode-usage.js";
import type { SessionErrorCode } from "./errors.js";
import { builtinUsageDecoders } from "./usage-decoders/index.js";
import type {
  UsageCursor,
  UsageDecodeFailure,
  UsageDecoders,
  UsagePlatform,
  UsageSource,
  UsageSourceFailure,
  UsageStream
} from "./usage-ports.js";

/**
 * A source last written longer ago than this is complete. Claude Code writes a response's records within minutes of
 * each other (the longest gap in the logs we have read is under 12 minutes), so the requests still open where such a
 * file ends get no more records.
 */
const QUIET_MS = 30 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The records of a source that have no request key: the time of the latest one read, and how many had that time. */
export interface UsageScanMark {
  readonly time: number;
  readonly count: number;
}

/** What a scan knows about one source. */
export interface UsageScanSource {
  readonly agent: CodingAgentId;
  /** Where the source was read last. */
  readonly path: string;
  /** Its modification time when it was listed last: once that is before `since`, no listing finds it any more. */
  readonly mtimeMs: number;
  /** Where its decode stopped; absent when it could not be read again after it was rewritten. */
  readonly cursor?: UsageCursor;
  /** Set when the source has records without a request key, for reading it again after a rewrite. */
  readonly mark?: UsageScanMark;
}

/** What a scan carries to the next one, as plain JSON data. */
export interface UsageScanState {
  /**
   * By agent and `UsageSource.id`, so a source that its agent moved keeps its cursor; by agent, id and path while one
   * scan finds the id at several paths (a copy), so each copy keeps a cursor of its own.
   */
  readonly sources: Readonly<Record<string, UsageScanSource>>;
  /**
   * The requests counted from `since` on, by agent and by the day (UTC, days since the epoch) of their record: each a
   * 54-bit hash of the request's key in 9 base64url characters, the hashes of one day joined.
   */
  readonly requests: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

interface ScanUsageCommon {
  /** Agents to scan, by id or alias; defaults to every agent with a usage decoder. */
  readonly agents?: readonly CodingAgentId[];
  /** Stops each source at its first record at or after this time. */
  readonly until?: number;
  readonly signal?: AbortSignal;
}

/**
 * A scan that continues from a state needs `since`: the state keeps the requests counted from then on, so it does not
 * grow with the history on disk.
 */
export type ScanUsageOptions = ScanUsageCommon &
  (
    | {
        /** Leaves out records before this time, in epoch milliseconds, and the sources last modified before it. */
        readonly since?: number;
        readonly state?: undefined;
      }
    | {
        readonly since: number;
        /** The state of the previous scan, to read only what was written since. */
        readonly state?: UsageScanState;
      }
  );

/** The records of a scan and the failures of its sources. Iterate it once; leaving the loop stops the reads. */
export interface UsageScan extends AsyncIterable<UsageRecord | UsageDecodeFailure | UsageSourceFailure> {
  /**
   * What the next scan continues from: the state passed in, with the sources this scan read moved on and the requests
   * it counted added. Once the loop has run to its end, it drops the sources that a complete listing of their agent
   * no longer finds (deleted, or not modified since `since`).
   */
  readonly state: UsageScanState;
}

/**
 * Scans the usage of every source `listUsageSources` finds, continuing each from its cursor in `state`, so a scan that
 * runs again reads only what was written since. A source last written more than 30 minutes ago, as its decode finds it,
 * is decoded with `final`, so a running session's last requests are reported at the latest 30 minutes after it went
 * quiet.
 *
 * A record counts once in the window, by a key its agent's rules give (`UsageDecoder.usageKey`): Claude Code's subagent
 * files repeat requests, Gemini CLI migrates an older chat into a `.jsonl` file, and a source rewritten under its cursor
 * (`SourceChanged`) is read again from its start. Claude Code's key is its request id, unique everywhere; the other
 * agents' keys hold the session, because their ids are unique only within it. A record without a key (an older Codex
 * `token_count`) is left out of a source read again up to the latest such record read from it, by time and by count
 * at that time.
 *
 * Once the loop has run to its end, a source that this scan did not find is dropped when its modification time is
 * before `since`, or when the listing of the root or directory that held it did not fail.
 */
export function scanUsage(
  platform: UsagePlatform & Pick<Platform, "env" | "home" | "clock">,
  options: ScanUsageOptions = {}
): UsageScan {
  const { agents, since, until, signal } = options;
  const previous = options.state;
  if (previous && since === undefined) {
    throw new AgentKitError<SessionErrorCode>("invalid-cursor", "A scan that continues from a state needs `since`");
  }
  const sources: Record<string, UsageScanSource> = { ...previous?.sources };
  const requests = restoreRequests(previous?.requests ?? {}, since);
  let current: { readonly key: string; readonly entry: () => UsageScanSource } | undefined;

  const decode = (source: UsageSource, from: UsageCursor | undefined): UsageStream =>
    decodeUsage(platform, source.agent, source, {
      ...(from ? { from } : {}),
      ...(since === undefined ? {} : { since }),
      ...(until === undefined ? {} : { until }),
      quietBefore: platform.clock.now() - QUIET_MS,
      ...(signal ? { signal } : {})
    });

  /** Whether the record was not counted in the window yet; remembers it. */
  const firstCount = (record: UsageRecord, key: string): boolean => {
    const counted = requests.get(record.agent) ?? { days: new Map<string, Set<string>>(), all: new Set<string>() };
    requests.set(record.agent, counted);
    const hash = shortHash(`${record.agent} ${key}`);
    if (counted.all.has(hash)) {
      return false;
    }
    counted.all.add(hash);
    const day = String(Math.floor(record.timestamp / DAY_MS));
    const hashes = counted.days.get(day) ?? new Set<string>();
    counted.days.set(day, hashes);
    hashes.add(hash);
    return true;
  };

  /** The state entry of a listed source, under the key it keeps in this scan. */
  const take = (source: UsageSource, listedTwice: boolean): { key: string; known?: UsageScanSource } => {
    const byId = `${source.agent} ${source.id}`;
    const byPath = `${byId} ${source.path}`;
    if (!listedTwice) {
      const known = sources[byId] ?? sources[byPath];
      delete sources[byPath];
      return known ? { key: byId, known } : { key: byId };
    }
    const known = sources[byPath] ?? (sources[byId]?.path === source.path ? sources[byId] : undefined);
    if (sources[byId]?.path === source.path) {
      delete sources[byId];
    }
    return known ? { key: byPath, known } : { key: byPath };
  };

  return {
    get state() {
      const all = { ...sources };
      if (current) {
        all[current.key] = current.entry();
      }
      return { sources: all, requests: saveRequests(requests) };
    },
    async *[Symbol.asyncIterator]() {
      const scanned = new Set(
        (agents ?? Object.keys(builtinUsageDecoders)).map((agent) => {
          const parsed = parseCodingAgentId(agent);
          return parsed.ok ? parsed.value : agent;
        })
      );
      // The listing first, to see which ids it finds at several paths.
      const listing: UsageSource[] = [];
      const failed: string[] = [];
      for await (const item of listUsageSources(platform, {
        ...(agents ? { agents } : {}),
        ...(since === undefined ? {} : { since }),
        ...(signal ? { signal } : {})
      })) {
        if (isUsageSource(item)) {
          listing.push(item);
        } else {
          failed.push(item.path);
          yield item;
        }
      }
      const ids = new Map<string, number>();
      for (const source of listing) {
        const id = `${source.agent} ${source.id}`;
        ids.set(id, (ids.get(id) ?? 0) + 1);
      }
      const used = new Set<string>();
      for (const source of listing) {
        const { key, known } = take(source, (ids.get(`${source.agent} ${source.id}`) ?? 0) > 1);
        used.add(key);
        let from = known?.cursor;
        let mark = known?.mark;
        let skip: UsageScanMark | undefined;
        for (;;) {
          const stream = decode(source, from);
          const entry = (): UsageScanSource => ({
            agent: source.agent,
            path: source.path,
            mtimeMs: source.mtimeMs,
            ...(stream.cursor ? { cursor: stream.cursor } : {}),
            ...(mark ? { mark } : {})
          });
          current = { key, entry };
          let changed = false;
          let skipped = 0;
          for await (const item of stream) {
            if (!isUsageRecord(item)) {
              changed = item.error._tag === "SourceChanged";
              yield item;
              continue;
            }
            const usageKey = (builtinUsageDecoders as UsageDecoders)[item.agent]?.usageKey(item);
            if (usageKey !== undefined) {
              if (firstCount(item, usageKey)) {
                yield item;
              }
              continue;
            }
            if (skip && (item.timestamp < skip.time || (item.timestamp === skip.time && skipped < skip.count))) {
              skipped += item.timestamp === skip.time ? 1 : 0;
              continue;
            }
            mark = nextMark(mark, item.timestamp);
            yield item;
          }
          sources[key] = entry();
          current = undefined;
          if (!changed || skip !== undefined) {
            break;
          }
          // Read the rewritten source again from its start; the keys and the mark leave out what was read before.
          from = undefined;
          skip = mark ?? { time: Number.NEGATIVE_INFINITY, count: 0 };
        }
      }
      for (const [key, known] of Object.entries(sources)) {
        if (used.has(key) || !scanned.has(known.agent)) {
          continue;
        }
        const outOfWindow = since !== undefined && known.mtimeMs < since;
        const unlisted = failed.some((path) => known.path === path || known.path.startsWith(`${path}/`));
        if (outOfWindow || !unlisted) {
          delete sources[key];
        }
      }
    }
  };
}

function nextMark(mark: UsageScanMark | undefined, time: number): UsageScanMark {
  if (mark === undefined || time > mark.time) {
    return { time, count: 1 };
  }
  return time === mark.time ? { time, count: mark.count + 1 } : mark;
}

interface CountedRequests {
  days: Map<string, Set<string>>;
  all: Set<string>;
}

function restoreRequests(
  saved: Readonly<Record<string, Readonly<Record<string, string>>>>,
  since: number | undefined
): Map<string, CountedRequests> {
  const out = new Map<string, CountedRequests>();
  for (const [agent, days] of Object.entries(saved)) {
    const counted: CountedRequests = { days: new Map(), all: new Set() };
    for (const [day, joined] of Object.entries(days)) {
      // A day that ended before `since` holds no request of the window.
      if (since !== undefined && (Number(day) + 1) * DAY_MS <= since) {
        continue;
      }
      const hashes = new Set<string>();
      for (let at = 0; at + SHORT_HASH_LENGTH <= joined.length; at += SHORT_HASH_LENGTH) {
        const hash = joined.slice(at, at + SHORT_HASH_LENGTH);
        hashes.add(hash);
        counted.all.add(hash);
      }
      counted.days.set(day, hashes);
    }
    out.set(agent, counted);
  }
  return out;
}

function saveRequests(requests: ReadonlyMap<string, CountedRequests>): Record<string, Record<string, string>> {
  return Object.fromEntries(
    [...requests].map(([agent, { days }]) => [
      agent,
      Object.fromEntries([...days].map(([day, hashes]) => [day, [...hashes].toSorted().join("")]))
    ])
  );
}
