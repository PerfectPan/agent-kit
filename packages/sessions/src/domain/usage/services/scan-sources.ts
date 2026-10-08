import type { CodingAgentId } from "@rivus/agent-kit-catalog";

/** What every entry of a scan's source state carries that the rules read; a cursor or a mark rides along. */
export interface ScanSourceEntry {
  readonly agent: CodingAgentId;
  readonly path: string;
  readonly mtimeMs: number;
}

/** The sources one scan knows, keyed so a source keeps its entry when its agent moves the file. */
export interface ScanSources<Entry extends ScanSourceEntry> {
  /**
   * The state entry of a listed source, under the key it keeps in this scan, and what the previous scan knew of it.
   * A source found once continues under `agent id`, so a moved file keeps its cursor; an id found at several paths (a
   * copy) keeps a cursor per path, under `agent id path`.
   */
  take(
    source: { readonly agent: CodingAgentId; readonly id: string; readonly path: string },
    listedTwice: boolean
  ): { readonly key: string; readonly known?: Entry };
  /** Records the entry of a source this scan read. */
  set(key: string, entry: Entry): void;
  /** The entries recorded so far, as the scan state keeps them. */
  all(): Readonly<Record<string, Entry>>;
  /**
   * Drops the sources this scan did not find that no longer count: an agent still scanned keeps its sources while a
   * listing of them failed, and loses the ones last modified before `since` or listed by a listing that succeeded.
   */
  prune(options: {
    /** The agents this scan covers, by parsed id. */
    readonly scanned: ReadonlySet<string>;
    /** The roots and directories whose listing failed. */
    readonly failed: readonly string[];
    readonly since?: number;
  }): void;
}

export function scanSources<Entry extends ScanSourceEntry>(saved: Readonly<Record<string, Entry>>): ScanSources<Entry> {
  const sources: Record<string, Entry> = { ...saved };
  const used = new Set<string>();
  return {
    take(source, listedTwice) {
      const byId = `${source.agent} ${source.id}`;
      const byPath = `${byId} ${source.path}`;
      if (!listedTwice) {
        const known = sources[byId] ?? sources[byPath];
        delete sources[byPath];
        used.add(byId);
        return known ? { key: byId, known } : { key: byId };
      }
      const known = sources[byPath] ?? (sources[byId]?.path === source.path ? sources[byId] : undefined);
      if (sources[byId]?.path === source.path) {
        delete sources[byId];
      }
      used.add(byPath);
      return known ? { key: byPath, known } : { key: byPath };
    },
    set(key, entry) {
      sources[key] = entry;
    },
    all: () => ({ ...sources }),
    prune({ scanned, failed, since }) {
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
