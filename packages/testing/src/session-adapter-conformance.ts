import type { Result } from "@rivus/agent-kit-catalog";
import type { ByteRange } from "@rivus/agent-kit-platform";
import {
  CAPABILITIES,
  type Capability,
  foldTranscript,
  isSessionHead,
  laneOf,
  latestSnapshot,
  mainAgentId,
  readLines,
  readOriginal,
  type SessionAdapter,
  type SessionPlatform,
  type SessionRef,
  snapshotHasSystemPrompt,
  snapshotHasTools,
  summarizeSession,
  type Transcript
} from "@rivus/agent-kit-sessions";
import { isEqual, isPlainObject } from "es-toolkit";

/** One fixture session and what its files demonstrate. */
export interface ConformanceSession {
  /** The session file `discover` must return. */
  readonly path: string;
  /** Every JSONL file of the session; defaults to `[path]`. */
  readonly files?: readonly string[];
  /** Non-blank lines across `files`. */
  readonly records: number;
  /** Capabilities this session demonstrates. `compaction` also requires at least one shadowed event. */
  readonly capabilities: readonly Capability[];
}

export interface SessionAdapterFixtures {
  readonly platform: SessionPlatform;
  /** A root whose sessions are exactly `sessions`. */
  readonly root: string;
  readonly sessions: readonly ConformanceSession[];
  /** A root that lists `file`, a session larger than 128 KB, such as one built by `oversizedSession`. */
  readonly oversized: { readonly root: string; readonly file: string };
}

/** One named check; `run` rejects with an `Error` describing the first violation. */
export interface ConformanceCheck {
  readonly name: string;
  readonly run: () => Promise<void>;
}

const DISCOVER_BUDGET = 128 * 1024;
const EDGE_BUDGET = 64 * 1024;

/** Capabilities a transcript lists exactly when its own files hold that content. */
const PRESENCE_CAPABILITIES: readonly Capability[] = ["systemPrompt", "toolSchemas"];

/** A session file of more than 128 KB made by repeating one JSONL line. */
export function oversizedSession(line: string): string {
  const once = line.endsWith("\n") ? line : `${line}\n`;
  const lineBytes = new TextEncoder().encode(once).byteLength;
  return once.repeat(Math.floor(DISCOVER_BUDGET / lineBytes) + 1);
}

/**
 * The checks every session adapter must pass, independent of a test runner: wire each into the runner, for example
 * `for (const { name, run } of sessionAdapterConformance(adapter, fixtures)) it(name, run)`.
 */
export function sessionAdapterConformance(
  adapter: SessionAdapter,
  fixtures: SessionAdapterFixtures
): ConformanceCheck[] {
  const { platform } = fixtures;
  const refOf = (session: ConformanceSession): SessionRef => ({ agent: adapter.agent, path: session.path });
  const load = async (session: ConformanceSession): Promise<Transcript> =>
    value(await adapter.load(platform, refOf(session)), `load ${session.path}`);
  const eachTranscript = async (
    test: (transcript: Transcript, session: ConformanceSession) => void | Promise<void>
  ) => {
    for (const session of fixtures.sessions) {
      await test(await load(session), session);
    }
  };

  const discover = async (root: string): Promise<{ found: string[]; reads: ReadLog }> => {
    const reads = readLog(platform);
    const found: string[] = [];
    for await (const item of adapter.discover(reads.platform, root)) {
      check(isSessionHead(item), `discover ${root} failed: ${isSessionHead(item) ? "" : JSON.stringify(item.error)}`);
      check(item.ref.agent === adapter.agent, `${item.ref.path}: head names agent ${item.ref.agent}`);
      found.push(item.ref.path);
    }
    return { found, reads };
  };

  return [
    {
      name: "discovers every fixture session within 128 KB per file",
      run: async () => {
        const { found, reads } = await discover(fixtures.root);
        const expected = fixtures.sessions.map((session) => session.path).toSorted();
        check(
          isEqual(found.toSorted(), expected),
          `discovered ${JSON.stringify(found)}, expected ${JSON.stringify(expected)}`
        );
        for (const [path, bytes] of reads.bytes) {
          check(bytes <= DISCOVER_BUDGET, `discover read ${bytes} bytes of ${path}`);
        }
      }
    },
    {
      name: "reads at most 64 KB from each end of a large session",
      run: async () => {
        const { file, root } = fixtures.oversized;
        const { found, reads } = await discover(root);
        check(found.includes(file), `discover ${root} did not list ${file}`);
        const bytes = reads.bytes.get(file) ?? 0;
        check(bytes > EDGE_BUDGET && bytes <= DISCOVER_BUDGET, `discover read ${bytes} bytes of ${file}`);
        const size = (await platform.fs.stat(file, { followSymlinks: true }))?.size ?? 0;
        const ranges = reads.ranges.get(file) ?? [];
        for (const range of ranges) {
          check(range.end - range.start <= EDGE_BUDGET, `discover read ${range.start}-${range.end} of ${file}`);
        }
        check(
          ranges.some((range) => range.end === size),
          `discover did not read the end of ${file}`
        );
      }
    },
    {
      name: "detects its own sessions",
      run: async () => {
        for (const session of fixtures.sessions) {
          check(await adapter.detect(platform, refOf(session)), `detect rejected ${session.path}`);
        }
      }
    },
    {
      name: "loads the same event ids in the same order",
      run: async () => {
        await eachTranscript(async (first, session) => {
          const second = await load(session);
          check(
            isEqual(
              second.events.map((event) => event.id),
              first.events.map((event) => event.id)
            ),
            `${session.path}: event ids differ between loads`
          );
          check(first.agent === adapter.agent, `${session.path}: transcript names agent ${first.agent}`);
        });
      }
    },
    {
      name: "accounts for every input record",
      run: async () => {
        await eachTranscript(async (transcript, session) => {
          const covered = new Set<string>();
          for (const event of transcript.events) {
            covered.add(`${event.source.file}\0${event.source.line}`);
          }
          for (const skip of transcript.skipped) {
            check(skip.reason.length > 0, `${skip.source.file}:${skip.source.line}: skipped without a reason`);
            covered.add(`${skip.source.file}\0${skip.source.line}`);
          }
          let records = 0;
          for (const file of session.files ?? [session.path]) {
            for await (const line of readLines(platform, file)) {
              if (line.text.trim()) {
                records += 1;
                check(
                  covered.has(`${file}\0${line.lineNumber}`),
                  `${file}:${line.lineNumber} is neither an event nor skipped`
                );
              }
            }
          }
          check(records === session.records, `${session.path}: ${records} records, expected ${session.records}`);
        });
      }
    },
    {
      name: "event ids are unique",
      run: async () => {
        await eachTranscript((transcript, session) => {
          const ids = transcript.events.map((event) => event.id);
          check(new Set(ids).size === ids.length, `${session.path}: duplicate event ids`);
        });
      }
    },
    {
      name: "seq matches the event index",
      run: async () => {
        await eachTranscript((transcript) => {
          transcript.events.forEach((event, index) => {
            check(event.seq === index, `${event.id}: seq ${event.seq} at index ${index}`);
          });
        });
      }
    },
    {
      name: "keeps file order for the events of each source file",
      run: async () => {
        // A request event is exempt: an agent that logs usage after the call places it before the call's first
        // output, ahead of its own record.
        await eachTranscript((transcript) => {
          const last = new Map<string, number>();
          for (const event of transcript.events) {
            if (event.kind === "request") {
              continue;
            }
            const previous = last.get(event.source.file) ?? -1;
            check(event.source.offset >= previous, `${event.id} at offset ${event.source.offset} after ${previous}`);
            last.set(event.source.file, event.source.offset);
          }
        });
      }
    },
    {
      name: "pairs tool results or flags them orphan",
      run: async () => {
        await eachTranscript((transcript) => {
          const seen = new Set<string>();
          for (const event of transcript.events) {
            const callId = typeof event.payload.callId === "string" ? event.payload.callId : undefined;
            const key = `${event.agentId ?? ""}\0${callId ?? ""}`;
            if (event.kind === "tool_call" && callId) {
              seen.add(key);
            } else if (event.kind === "tool_result") {
              const matched = callId !== undefined && seen.has(key);
              check(
                matched !== (event.payload.orphan === true),
                `${event.id}: orphan flag is ${!matched ? "missing" : "wrong"}`
              );
            }
          }
        });
      }
    },
    {
      name: "points shadowedBy at a later compaction on the same lane",
      run: async () => {
        await eachTranscript((transcript, session) => {
          if (session.capabilities.includes("compaction")) {
            check(
              transcript.events.some((event) => event.shadowedBy !== undefined),
              `${session.path} demonstrates compaction, but no event is shadowed`
            );
          }
          const byId = new Map(transcript.events.map((event) => [event.id, event]));
          for (const event of transcript.events) {
            if (event.shadowedBy === undefined) {
              continue;
            }
            const compaction = byId.get(event.shadowedBy);
            check(compaction?.kind === "compaction", `${event.id}: shadowedBy ${event.shadowedBy} is not a compaction`);
            check(compaction.seq > event.seq, `${event.id}: shadowed by an earlier compaction`);
            check((compaction.agentId ?? "") === (event.agentId ?? ""), `${event.id}: shadowed from another lane`);
          }
        });
      }
    },
    {
      name: "resolves every reference between events and lanes",
      run: async () => {
        await eachTranscript((transcript, session) => {
          const events = new Map(transcript.events.map((event) => [event.id, event]));
          const lanes = new Map(transcript.agents.map((lane) => [lane.id, lane]));
          const rootId = mainAgentId(transcript);
          const requests = new Set(
            transcript.events.flatMap((event) => (event.kind === "request" ? [event.requestId] : []))
          );
          const roots = transcript.agents.filter((lane) => lane.parentId === undefined);
          check(roots.length === 1, `${session.path}: ${roots.length} root lanes`);
          for (const lane of transcript.agents) {
            const seen = new Set<string>();
            for (let at: string | undefined = lane.id; at !== undefined; at = lanes.get(at)?.parentId) {
              check(lanes.has(at), `lane ${lane.id}: parent ${at} is not a lane`);
              check(!seen.has(at), `lane ${lane.id}: parent cycle`);
              seen.add(at);
            }
            if (lane.spawnEventId !== undefined) {
              const spawn = events.get(lane.spawnEventId);
              const kind = spawn?.kind;
              check(
                spawn !== undefined &&
                  lane.parentId !== undefined &&
                  laneOf(spawn, rootId) === lane.parentId &&
                  (kind === "tool_call" || kind === "system"),
                `lane ${lane.id}: spawn event is not a tool_call or system event on the parent lane`
              );
            }
          }
          for (const event of transcript.events) {
            check(
              event.agentId === undefined || lanes.has(event.agentId),
              `${event.id}: lane ${event.agentId} is missing`
            );
            check(
              event.parentId === undefined || events.has(event.parentId),
              `${event.id}: parent ${event.parentId} is missing`
            );
            check(
              event.requestId === undefined || requests.has(event.requestId),
              `${event.id}: request ${event.requestId} is missing`
            );
          }
        });
      }
    },
    {
      name: "reads each source pointer back to original",
      run: async () => {
        await eachTranscript(async (transcript) => {
          for (const event of transcript.events) {
            const original = value(await readOriginal(platform, event.source), `readOriginal ${event.id}`);
            check(isEqual(original, event.original), `${event.id}: the record at its source pointer differs`);
          }
        });
      }
    },
    {
      name: "shows each claimed capability and no undeclared one",
      run: async () => {
        const declared = new Set(adapter.capabilities);
        const claimed = new Set<Capability>();
        await eachTranscript((transcript, session) => {
          const listed = new Set(transcript.capabilities);
          for (const capability of listed) {
            check(declared.has(capability), `${session.path} lists undeclared ${capability}`);
          }
          for (const capability of session.capabilities) {
            claimed.add(capability);
            check(listed.has(capability), `${session.path} does not list ${capability}`);
            check(capabilitySeen(transcript, capability), `${session.path} lists ${capability} but shows none`);
          }
          for (const capability of CAPABILITIES) {
            if (!listed.has(capability)) {
              check(!capabilitySeen(transcript, capability), `${session.path} shows unlisted ${capability}`);
            }
          }
          for (const capability of PRESENCE_CAPABILITIES) {
            check(
              listed.has(capability) === capabilitySeen(transcript, capability),
              `${session.path} lists ${capability} without its content, or the reverse`
            );
          }
        });
        for (const capability of adapter.capabilities) {
          check(claimed.has(capability), `no fixture session demonstrates ${capability}`);
        }
      }
    },
    {
      name: "summarizes like foldTranscript(load())",
      run: async () => {
        await eachTranscript(async (transcript, session) => {
          const summary = value(
            await summarizeSession(platform, refOf(session), { adapters: { [adapter.agent]: adapter } }),
            `summarize ${session.path}`
          );
          check(
            isEqual(summary, foldTranscript(transcript)),
            `${session.path}: summary differs from the folded transcript`
          );
        });
      }
    }
  ];
}

function value<T>(result: Result<T, { readonly _tag: string }>, what: string): T {
  if (!result.ok) {
    throw new Error(`${what} failed: ${result.error._tag}`);
  }
  return result.value;
}

export function check(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function capabilitySeen(transcript: Transcript, capability: Capability): boolean {
  const { events } = transcript;
  const finite = (value: unknown): boolean => typeof value === "number" && Number.isFinite(value);
  switch (capability) {
    case "requests":
      return events.some((event) => event.kind === "request");
    case "usage":
      return events.some((event) => event.kind === "request" && isPlainObject(event.payload.usage));
    case "durations":
      return events.some(
        (event) =>
          (event.kind === "request" || (event.kind === "system" && event.payload.type === "turn_duration")) &&
          finite(event.payload.durationMs)
      );
    case "reasoning":
      return events.some((event) => event.kind === "reasoning");
    case "compaction":
      return events.some((event) => event.kind === "compaction");
    case "compactionTokens":
      return events.some(
        (event) => event.kind === "compaction" && (finite(event.payload.preTokens) || finite(event.payload.postTokens))
      );
    case "subagents":
      return transcript.agents.some((lane) => lane.parentId !== undefined);
    case "systemPrompt":
      return (
        Boolean(transcript.session.systemPrompt) ||
        transcript.agents.some((lane) => Boolean(lane.systemPrompt)) ||
        latestSnapshot(events, snapshotHasSystemPrompt) !== undefined
      );
    case "toolSchemas":
      return transcript.session.tools !== undefined || latestSnapshot(events, snapshotHasTools) !== undefined;
    case "hooks":
      return events.some((event) => event.kind === "hook");
    default:
      return false;
  }
}

interface ReadLog {
  /** The wrapped platform, whose reads are logged. */
  readonly platform: SessionPlatform;
  readonly bytes: Map<string, number>;
  readonly ranges: Map<string, { start: number; end: number }[]>;
}

/** Logs the bytes and ranges read through the returned platform, per path. */
function readLog(platform: SessionPlatform): ReadLog {
  const { fs } = platform;
  const bytes = new Map<string, number>();
  const ranges = new Map<string, { start: number; end: number }[]>();
  const record = (path: string, start: number, end: number): void => {
    bytes.set(path, (bytes.get(path) ?? 0) + end - start);
    ranges.set(path, [...(ranges.get(path) ?? []), { start, end }]);
  };
  return {
    bytes,
    ranges,
    platform: {
      fs: {
        stat: (path, options) => fs.stat(path, options),
        list: (dir) => fs.list(dir),
        async *read(path: string, range?: ByteRange) {
          const start = range?.start ?? 0;
          let end = start;
          try {
            for await (const chunk of fs.read(path, range)) {
              end += chunk.byteLength;
              yield chunk;
            }
          } finally {
            if (end > start) {
              record(path, start, end);
            }
          }
        }
      }
    }
  };
}
