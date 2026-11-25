import { definedFields } from "@rivus/agent-kit-catalog/spi";
import { edgeRecords, readEdges, type SessionPlatform } from "@rivus/agent-kit-sessions/spi";
import { copilotJournalPreviousFileOf, copilotRecordOf } from "../records.js";

/** Replaces the filename of `path` with `fileName`, preserving the directory prefix and separator style. */
function siblingPath(path: string, fileName: string): string | undefined {
  const normalized = path.replaceAll("\\", "/");
  const slash = normalized.lastIndexOf("/");
  return slash < 0 ? undefined : `${path.slice(0, slash + 1)}${fileName}`;
}

/** Finds `session.journal_link.data.previousFile` near the head/tail of a journal segment. */
function previousSegmentName(records: readonly Record<string, unknown>[]): string | undefined {
  for (const raw of records) {
    const record = copilotRecordOf(raw);
    if (record?.type === "session.journal_link") {
      const previous = copilotJournalPreviousFileOf(record);
      if (previous !== undefined) {
        return previous;
      }
    }
  }
  return undefined;
}

/**
 * Resolves a Copilot session's rotated journal chain oldest-first (`[oldest, ..., currentPath]`). Missing or
 * unreadable earlier segments stop the walk without failing the current segment, and cycles are ignored.
 */
export async function resolveCopilotJournalChain(
  platform: SessionPlatform,
  currentPath: string,
  signal: AbortSignal | undefined
): Promise<readonly string[]> {
  const chain: string[] = [currentPath];
  const seen = new Set<string>([currentPath]);
  let cursor = currentPath;
  for (;;) {
    signal?.throwIfAborted();
    const edges = await readEdges(platform, cursor, definedFields({ signal }));
    if (edges === undefined) {
      break;
    }
    const previous = previousSegmentName(edgeRecords(edges));
    if (previous === undefined) {
      break;
    }
    const nextPath = siblingPath(cursor, previous);
    if (nextPath === undefined || seen.has(nextPath)) {
      break;
    }
    const info = await platform.fs.stat(nextPath, { followSymlinks: true }).catch(() => {
      signal?.throwIfAborted();
      return undefined;
    });
    if (info?.kind !== "file") {
      break;
    }
    seen.add(nextPath);
    chain.push(nextPath);
    cursor = nextPath;
  }
  return chain.reverse();
}
