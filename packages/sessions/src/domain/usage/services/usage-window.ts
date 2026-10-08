import type { CodingAgentId } from "@rivus/agent-kit-catalog";

import type { UsageRecord } from "../value-objects/usage-record.js";
import { SHORT_HASH_LENGTH, shortHash } from "./short-hash.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The window's counted requests of one agent: the hashes of each UTC day, and all of them together. */
interface CountedRequests {
  days: Map<string, Set<string>>;
  all: Set<string>;
}

/** The requests one scan window counts, remembered so the next records of the same requests count no again. */
export interface UsageWindow {
  /** Whether the record's request is new in the window, by its agent's `usageKey`; remembers it when so. */
  count(record: UsageRecord, key: string): boolean;
  /** The counted requests as the scan state keeps them. */
  save(): Record<string, Record<string, string>>;
}

/**
 * The window of request keys a scan counts, restored from the previous scan's state. A record counts once in the
 * window: by a 54-bit hash of its agent and key, kept per UTC day of its record, so the state does not grow with the
 * history before `since` — a day that ended before `since` holds no request of the window and is not restored.
 */
export function restoreUsageWindow(
  saved: Readonly<Record<string, Readonly<Record<string, string>>>>,
  since: number | undefined
): UsageWindow {
  const requests = new Map<CodingAgentId, CountedRequests>();
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
    requests.set(agent as CodingAgentId, counted);
  }
  return {
    count(record, key) {
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
    },
    save() {
      return Object.fromEntries(
        [...requests].map(([agent, { days }]) => [
          agent,
          Object.fromEntries([...days].map(([day, hashes]) => [day, [...hashes].toSorted().join("")]))
        ])
      );
    }
  };
}
