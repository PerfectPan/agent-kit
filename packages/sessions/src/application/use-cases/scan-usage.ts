import { AgentKitError, type CodingAgentId, parseCodingAgentId } from "@rivus/agent-kit-catalog";
import type { Platform } from "@rivus/agent-kit-platform";

import {
  QUIET_MS,
  keylessRecordRead,
  nextMark,
  restoreUsageWindow,
  scanSources,
  type UsageRecord,
  type UsageScanMark,
  type UsageScanSource,
  type UsageScanState
} from "../../domain/usage/index.js";
import { decodeUsage, isUsageRecord, isUsageSource, listUsageSources } from "./decode-usage.js";
import type { SessionErrorCode } from "../errors.js";
import { builtinUsageDecoders } from "../services/usage-decoders/index.js";
import type {
  UsageCursor,
  UsageDecodeFailure,
  UsageDecoders,
  UsagePlatform,
  UsageSource,
  UsageSourceFailure,
  UsageStream
} from "../usage-ports.js";

export type { UsageScanMark, UsageScanSource, UsageScanState };

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
  const sources = scanSources<UsageScanSource>(previous?.sources ?? {});
  const window = restoreUsageWindow(previous?.requests ?? {}, since);
  let current: { readonly key: string; readonly entry: () => UsageScanSource } | undefined;

  const decode = (source: UsageSource, from: UsageCursor | undefined): UsageStream =>
    decodeUsage(platform, source.agent, source, {
      ...(from ? { from } : {}),
      ...(since === undefined ? {} : { since }),
      ...(until === undefined ? {} : { until }),
      quietBefore: platform.clock.now() - QUIET_MS,
      ...(signal ? { signal } : {})
    });

  return {
    get state() {
      const all = { ...sources.all() };
      if (current) {
        all[current.key] = current.entry();
      }
      return { sources: all, requests: window.save() };
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
      for (const source of listing) {
        const { key, known } = sources.take(source, (ids.get(`${source.agent} ${source.id}`) ?? 0) > 1);
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
              if (window.count(item, usageKey)) {
                yield item;
              }
              continue;
            }
            if (skip !== undefined && keylessRecordRead(skip, item.timestamp, skipped)) {
              skipped += item.timestamp === skip.time ? 1 : 0;
              continue;
            }
            mark = nextMark(mark, item.timestamp);
            yield item;
          }
          sources.set(key, entry());
          current = undefined;
          if (!changed || skip !== undefined) {
            break;
          }
          // Read the rewritten source again from its start; the keys and the mark leave out what was read before.
          from = undefined;
          skip = mark ?? { time: Number.NEGATIVE_INFINITY, count: 0 };
        }
      }
      sources.prune({ scanned, failed, ...(since === undefined ? {} : { since }) });
    }
  };
}
