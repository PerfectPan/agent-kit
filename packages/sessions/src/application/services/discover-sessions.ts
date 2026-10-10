import type { CodingAgentId } from "@rivus/agent-kit-catalog";

import {
  type SessionHead,
  type SessionListError,
  type SessionListFailure,
  type SessionPreview,
  sessionHead
} from "../../domain/session/index.js";
import { edgeRecords, readEdges } from "./files/edges.js";
import { walkFiles, type WalkSpec } from "./files/walk.js";
import type { DiscoverOptions, SessionPlatform } from "../ports.js";

export interface DiscoverSessionsOptions extends DiscoverOptions {
  /** Which files under the root are sessions. */
  readonly files: WalkSpec;
  /** The agent's preview rule over the records at both ends of one file. */
  readonly preview: (records: readonly Record<string, unknown>[]) => SessionPreview;
  /** Adds what a file next to the session says, such as a summary file. */
  readonly decorate?: (platform: SessionPlatform, path: string, head: SessionHead) => Promise<void>;
}

function failure(agent: CodingAgentId, path: string, error: SessionListError): SessionListFailure {
  return { ref: { agent, path }, error };
}

function readFailed(path: string, cause: unknown): SessionListError {
  return { _tag: "ReadFailed", path, message: cause instanceof Error ? cause.message : String(cause), cause };
}

async function readHead(
  platform: SessionPlatform,
  agent: CodingAgentId,
  path: string,
  options: DiscoverSessionsOptions
): Promise<SessionHead | undefined> {
  const edges = await readEdges(platform, path, { signal: options.signal });
  if (!edges) {
    return undefined;
  }
  const preview = options.preview(edgeRecords(edges));
  const head = sessionHead({ agent, path, ...(preview.sessionId ? { sessionId: preview.sessionId } : {}) }, preview, {
    sizeBytes: edges.size,
    mtimeMs: edges.mtimeMs
  });
  await options.decorate?.(platform, path, head);
  return head;
}

/**
 * The common `discover` of a file-per-session agent: walk the root, read both ends of each session file, and build
 * its head from the agent's preview. A missing root, an unreadable directory or an unreadable file becomes a failure
 * item and listing goes on; an abort rejects.
 */
export async function* discoverSessions(
  platform: SessionPlatform,
  agent: CodingAgentId,
  root: string,
  options: DiscoverSessionsOptions
): AsyncGenerator<SessionHead | SessionListFailure, void, undefined> {
  const { signal } = options;
  if ((await platform.fs.stat(root, { followSymlinks: true })) === undefined) {
    yield failure(agent, root, { _tag: "RootMissing", path: root });
    return;
  }
  let paths: string[];
  const unreadable: SessionListFailure[] = [];
  try {
    paths = await walkFiles(platform, root, options.files, {
      ...(signal ? { signal } : {}),
      onError: (dir, error) => unreadable.push(failure(agent, dir, readFailed(dir, error)))
    });
  } catch (error) {
    signal?.throwIfAborted();
    yield failure(agent, root, readFailed(root, error));
    return;
  }
  yield* unreadable;
  options.onTotal?.(paths.length);
  for (const path of paths) {
    signal?.throwIfAborted();
    let head: SessionHead | undefined;
    try {
      head = await readHead(platform, agent, path, options);
    } catch (error) {
      signal?.throwIfAborted();
      yield failure(agent, path, readFailed(path, error));
      continue;
    }
    if (head) {
      yield head;
    }
  }
}
