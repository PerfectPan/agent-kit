import { ok, type Result } from "@rivus/agent-kit-catalog";

import {
  CLAUDE_CODE_CAPABILITIES,
  CLAUDE_CODE_SESSION_FILES,
  CLAUDE_CODE_SUBAGENT_DEPTH,
  claudeCodeAgentIdFromFile,
  claudeCodeAgentMeta,
  type ClaudeCodeAgentMeta,
  claudeCodeCapabilities,
  claudeCodeMetaPath,
  claudeCodeRoots,
  claudeCodeSubagentDir,
  claudeCodeSubagentFile,
  looksLikeClaudeCodeSession,
  previewClaudeCodeRecords,
  translateClaudeCodeRecords
} from "../../../domain/adapters/claude-code/index.js";
import type { SessionRef } from "../../../domain/session/index.js";
import {
  createTranscript,
  mergeByTime,
  type SkippedRecord,
  type SourcedRecord,
  type Transcript
} from "../../../domain/transcript/index.js";
import { discoverSessions } from "../discover-sessions.js";
import { catchIoFailure } from "../files/io-failure.js";
import { readEdges } from "../files/edges.js";
import { readJsonlRecords } from "../files/jsonl.js";
import { readBytes, type ReadProgress, readProgress } from "../files/read-file.js";
import { walkFiles } from "../files/walk.js";
import type { LoadOptions, SessionAdapter, SessionPlatform, SessionReadError } from "../../ports.js";

const AGENT = "claude-code";
const UTF8_BOM = [0xef, 0xbb, 0xbf];

export const claudeCodeSessionAdapter: SessionAdapter = {
  specificationVersion: "sessions-v1",
  agent: AGENT,
  displayName: "Claude Code",
  capabilities: CLAUDE_CODE_CAPABILITIES,
  roots: claudeCodeRoots,
  discover(platform, root, options = {}) {
    return discoverSessions(platform, AGENT, root, {
      ...options,
      files: CLAUDE_CODE_SESSION_FILES,
      preview: previewClaudeCodeRecords
    });
  },
  async detect(platform, ref) {
    if (looksLikeClaudeCodeSession(ref.path, undefined)) {
      return true;
    }
    // A head in another format is `false`; an IO error must reach the caller's `catchIoFailure`.
    return looksLikeClaudeCodeSession(ref.path, (await readEdges(platform, ref.path))?.head);
  },
  load: loadClaudeCode
};

async function loadClaudeCode(
  platform: SessionPlatform,
  ref: SessionRef,
  options: LoadOptions = {}
): Promise<Result<Transcript, SessionReadError>> {
  const progress = readProgress(options.onProgress);
  const files = await catchIoFailure(platform, ref.path, options.signal, async (guarded) => ({
    main: await readJsonlRecords(guarded, ref.path, { signal: options.signal, progress }),
    nested: await readSubagents(guarded, ref.path, options.signal, progress)
  }));
  if (!files.ok) {
    return files;
  }
  const { main, nested } = files.value;
  const translated = translateClaudeCodeRecords(mergeByTime([main.records, ...nested.groups]), {
    ...(ref.sessionId === undefined ? {} : { sessionId: ref.sessionId }),
    path: ref.path,
    agentForFile: (file) => nested.agentForFile.get(file),
    agentMeta: nested.metas
  });
  if (!translated.ok) {
    return translated;
  }
  const parsed = translated.value;
  parsed.skipped.push(...main.skipped, ...nested.skipped);
  options.signal?.throwIfAborted();
  return ok(createTranscript(AGENT, claudeCodeCapabilities(parsed.events), parsed));
}

interface Subagents {
  groups: SourcedRecord[][];
  agentForFile: Map<string, string>;
  metas: Map<string, ClaudeCodeAgentMeta>;
  skipped: SkippedRecord[];
}

/**
 * Reads the session's subagent directory. Meta files and files that hold no records become whole-file skipped
 * records; a meta file that is not JSON is skipped as `invalid-json` and gives its lane no title.
 */
async function readSubagents(
  platform: SessionPlatform,
  sessionPath: string,
  signal: AbortSignal | undefined,
  progress: ReadProgress
): Promise<Subagents> {
  const out: Subagents = { groups: [], agentForFile: new Map(), metas: new Map(), skipped: [] };
  const dir = claudeCodeSubagentDir(sessionPath);
  if ((await platform.fs.stat(dir, { followSymlinks: true }))?.kind !== "dir") {
    return out;
  }
  const files = await walkFiles(platform, dir, { match: () => true, maxDepth: CLAUDE_CODE_SUBAGENT_DEPTH }, { signal });
  const metaFiles = new Set<string>();
  for (const path of files) {
    const kind = claudeCodeSubagentFile(path.slice(path.lastIndexOf("/") + 1));
    if (kind === "transcript") {
      const { records, skipped } = await readJsonlRecords(platform, path, { signal, progress });
      out.agentForFile.set(path, claudeCodeAgentIdFromFile(path, records));
      out.groups.push(records);
      out.skipped.push(...skipped);
    } else if (kind === "meta") {
      metaFiles.add(path);
    } else {
      out.skipped.push(await wholeFile(platform, path, "journal"));
    }
  }
  for (const [path, agentId] of out.agentForFile) {
    const metaPath = claudeCodeMetaPath(path);
    if (!metaFiles.delete(metaPath)) {
      continue;
    }
    const bytes = await readBytes(platform, metaPath, undefined, { signal, progress });
    // Like `splitLines`, the pointer starts after a UTF-8 byte order mark, so it addresses exactly the JSON text.
    const start = UTF8_BOM.every((byte, at) => bytes[at] === byte) ? UTF8_BOM.length : 0;
    const source = { file: metaPath, offset: start, length: bytes.byteLength - start, line: 1 };
    try {
      out.metas.set(
        agentId,
        claudeCodeAgentMeta(JSON.parse(new TextDecoder().decode(bytes.subarray(start))) as unknown)
      );
      out.skipped.push({ reason: "agent-meta", source });
    } catch {
      out.skipped.push({ reason: "invalid-json", source });
    }
  }
  for (const path of metaFiles) {
    out.skipped.push(await wholeFile(platform, path, "agent-meta"));
  }
  return out;
}

async function wholeFile(platform: SessionPlatform, path: string, reason: string): Promise<SkippedRecord> {
  const size = (await platform.fs.stat(path))?.size ?? 0;
  return { reason, source: { file: path, offset: 0, length: size, line: 1 } };
}
