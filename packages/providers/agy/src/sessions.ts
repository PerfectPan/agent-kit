import { definedFields, err, ok } from "@rivus/agent-kit-catalog/spi";
import {
  assignSeq,
  catchIoFailure,
  createTranscript,
  edgeRecords,
  readEdges,
  readJsonlStream,
  readSessionJsonl,
  sessionHead,
  type JsonlRecords,
  type Lane,
  type SessionAdapter,
  type SessionPlatform,
  type SessionReadError,
  type TranscriptEvent
} from "@rivus/agent-kit-sessions/spi";
import { AGY_DISPLAY_NAME, AGY_HOME, AGY_ID, AGY_TRANSCRIPT_FULL_REL, AGY_TRANSCRIPT_REL } from "./facts.js";
import { agyConversationLocation, agyRoots, agySessionIdFromPath } from "./layout.js";
import { AGY_CAPABILITIES, createAgyTranslation } from "./sessions/events.js";
import { previewAgyRecords } from "./sessions/preview.js";
import { summarizeAgyRecords } from "./sessions/summarize.js";
import {
  agyIsSpawnedConversation,
  agyLane,
  agyTranscriptPath,
  agyUnavailableLane,
  createAgySpawnQueue,
  readAgyLaneRecords,
  type AgyChildLane
} from "./sessions/subagents.js";

// Antigravity CLI writes per-conversation JSONL step logs under
// `<home>/antigravity-cli/brain/<conversation-id>/.system_generated/logs/`: `transcript_full.jsonl` keeps complete
// content and `transcript.jsonl` truncates long fields. Discovery prefers `transcript_full.jsonl` when present and
// falls back to `transcript.jsonl` so each conversation yields one session.
//
// A subagent is a conversation of its own under the same brain root: the parent's `invoke_subagent` tool result names
// its conversation id, and its own transcript starts with the message that spawned it. Discovery lists no such
// conversation as a session; load attaches each one the root's records spawned as a lane after the root lane, then
// the lanes they spawned, in that order.

/** One subagent conversation's transcript: its path and records, or neither when the transcript did not read. */
async function readAgyChild(
  platform: SessionPlatform,
  lane: AgyChildLane,
  brainRoot: string | undefined,
  signal: AbortSignal | undefined
): Promise<{ path: string; records: JsonlRecords } | undefined> {
  const path =
    brainRoot === undefined
      ? undefined
      : await agyTranscriptPath(platform, `${brainRoot}/${lane.conversationId}`, signal);
  if (path === undefined) {
    return undefined;
  }
  const read = await readAgyLaneRecords(platform, path, signal);
  return read.ok ? { path, records: read.value } : undefined;
}

export const agySessionAdapter: SessionAdapter = {
  specificationVersion: "sessions-v1",
  agent: AGY_ID,
  displayName: AGY_DISPLAY_NAME,
  capabilities: AGY_CAPABILITIES,
  home: AGY_HOME,
  roots: agyRoots,
  async *discover(platform, root, options = {}) {
    const { signal } = options;
    signal?.throwIfAborted();
    if ((await platform.fs.stat(root, { followSymlinks: true })) === undefined) {
      yield { ref: { agent: AGY_ID, path: root }, error: { _tag: "RootMissing", path: root } as const };
      return;
    }
    const conversations = await platform.fs.list(root).catch(() => []);
    signal?.throwIfAborted();
    for (const entry of conversations) {
      signal?.throwIfAborted();
      if (entry.kind !== "dir") {
        continue;
      }
      const fullPath = `${root}/${entry.name}/${AGY_TRANSCRIPT_FULL_REL}`;
      const compactPath = `${root}/${entry.name}/${AGY_TRANSCRIPT_REL}`;
      const fullEdges = await readEdges(platform, fullPath, definedFields({ signal }));
      const path = fullEdges !== undefined ? fullPath : compactPath;
      const edges = fullEdges ?? (await readEdges(platform, compactPath, definedFields({ signal })));
      if (edges === undefined) {
        continue;
      }
      const records = edgeRecords(edges);
      if (agyIsSpawnedConversation(records[0], entry.name)) {
        continue;
      }
      const preview = previewAgyRecords(records);
      yield sessionHead(definedFields({ agent: AGY_ID, path, sessionId: entry.name }), preview, {
        sizeBytes: edges.size,
        mtimeMs: edges.mtimeMs
      });
    }
  },
  async detect(platform, ref) {
    const info = await platform.fs.stat(ref.path, { followSymlinks: true });
    const normalized = ref.path.replaceAll("\\", "/");
    return (
      info?.kind === "file" &&
      (normalized.endsWith(`/${AGY_TRANSCRIPT_FULL_REL}`) || normalized.endsWith(`/${AGY_TRANSCRIPT_REL}`))
    );
  },
  async load(platform, ref, options = {}) {
    const file = await readSessionJsonl(platform, ref.path, options);
    if (!file.ok) {
      return file;
    }
    const rootId = ref.sessionId ?? agySessionIdFromPath(ref.path);
    const translation = createAgyTranslation({ retain: true });
    for (const record of file.value.records) {
      translation.step(record);
    }
    const lanes: Lane[] = [{ id: AGY_ID }];
    const laneEvents: TranscriptEvent[][] = [translation.events];
    const skipped = [...file.value.skipped];
    const brainRoot = agyConversationLocation(ref.path)?.brainRoot;
    const queue = createAgySpawnQueue(rootId);
    queue.enqueue(translation.spawns, AGY_ID);
    for (let lane = queue.next(); lane !== undefined; lane = queue.next()) {
      options.signal?.throwIfAborted();
      // A subagent whose transcript is missing or could not be read is a lane without events, so the parent's
      // record of it stays visible; the parent's transcript still loads.
      const child = await readAgyChild(platform, lane, brainRoot, options.signal);
      if (child === undefined) {
        lanes.push(agyUnavailableLane(lane));
        continue;
      }
      const childTranslation = createAgyTranslation({ retain: true, laneId: lane.conversationId });
      for (const record of child.records.records) {
        childTranslation.step(record);
      }
      const childParsed = childTranslation.finish({ id: lane.conversationId }, []);
      laneEvents.push(childTranslation.events);
      skipped.push(...child.records.skipped, ...childParsed.skipped);
      lanes.push(agyLane(lane));
      queue.enqueue(childTranslation.spawns, lane.conversationId);
    }

    const parsed = translation.finish(definedFields({ id: rootId }), lanes);
    // The lanes join in pass order — the root conversation first, then each subagent's — the order the summarize
    // pass folds; each lane's own event order, inherited times and orphan flags are final from its finish.
    const events = laneEvents.flat();
    assignSeq(events);
    parsed.events = events;
    parsed.agents = lanes;
    parsed.skipped = [...skipped, ...parsed.skipped];
    options.signal?.throwIfAborted();
    return ok(createTranscript(AGY_ID, AGY_CAPABILITIES, parsed));
  },
  summarize: (platform, ref, options = {}) =>
    catchIoFailure(platform, ref.path, options.signal, (guarded) =>
      summarizeAgyRecords({
        platform: guarded,
        records: readJsonlStream(guarded, ref.path, definedFields({ signal: options.signal })),
        rootId: ref.sessionId ?? agySessionIdFromPath(ref.path),
        brainRoot: agyConversationLocation(ref.path)?.brainRoot,
        signal: options.signal,
        prompts: options.prompts
      })
    ).then((outcome) => (outcome.ok ? outcome.value : err(outcome.error as SessionReadError)))
};
