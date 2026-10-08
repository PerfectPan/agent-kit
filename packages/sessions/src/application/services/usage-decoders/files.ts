import { type CodingAgentId, ok, type Result } from "@rivus/agent-kit-catalog";

import type { UsageFile, UsageLineDecoder } from "../../../domain/adapters/usage-lines.js";
import type { SessionListError } from "../../../domain/session/index.js";
import type { SourceChanged } from "../../../domain/transcript/index.js";
import { decodeIsFinal, type UsageRecord } from "../../../domain/usage/index.js";
import { guardIo } from "../files/io-failure.js";
import { readBytes, readLines } from "../files/read-file.js";
import { walkFiles, type WalkSpec } from "../files/walk.js";
import type { SessionPlatform } from "../../ports.js";
import type {
  UsageCursor,
  UsageDecodeError,
  UsageDecodeFailure,
  DecodeUsageOptions,
  UsagePlatform,
  UsageSource,
  UsageSourceFailure,
  UsageSourceOptions,
  UsageStream,
  UsageTarget
} from "../../usage-ports.js";

/**
 * The files under `roots` that `spec` and `keep` accept, as usage sources, leaving out those last modified before
 * `since`. A missing root, a directory that cannot be listed and a file that cannot be read are failure items.
 */
export async function* fileSources(
  platform: SessionPlatform,
  agent: CodingAgentId,
  roots: readonly string[],
  spec: WalkSpec,
  options: UsageSourceOptions & {
    /** The source's identity (`UsageSource.id`) from its path below `root`. */
    readonly identify: (path: string, root: string) => string;
    readonly keep?: (path: string, all: ReadonlySet<string>) => boolean;
  }
): AsyncGenerator<UsageSource | UsageSourceFailure, void, undefined> {
  const { signal } = options;
  for (const root of roots) {
    signal?.throwIfAborted();
    const failures: UsageSourceFailure[] = [];
    let paths: string[];
    try {
      if ((await platform.fs.stat(root, { followSymlinks: true })) === undefined) {
        yield { agent, path: root, error: { _tag: "RootMissing", path: root } };
        continue;
      }
      paths = await walkFiles(platform, root, spec, {
        ...(signal ? { signal } : {}),
        onError: (dir, error) => failures.push({ agent, path: dir, error: readFailed(dir, error) })
      });
    } catch (error) {
      signal?.throwIfAborted();
      yield { agent, path: root, error: readFailed(root, error) };
      continue;
    }
    yield* failures;
    const all = new Set(paths);
    for (const path of paths) {
      if (options.keep && !options.keep(path, all)) {
        continue;
      }
      signal?.throwIfAborted();
      let source: UsageSource | undefined;
      try {
        const info = await platform.fs.stat(path, { followSymlinks: true });
        if (info?.kind === "file") {
          source = { agent, id: options.identify(path, root), path, mtimeMs: info.mtimeMs, sizeBytes: info.size };
        }
      } catch (error) {
        signal?.throwIfAborted();
        yield { agent, path, error: readFailed(path, error) };
        continue;
      }
      if (source && (options.since === undefined || source.mtimeMs >= options.since)) {
        yield source;
      }
    }
  }
}

function readFailed(path: string, cause: unknown): SessionListError {
  return { _tag: "ReadFailed", path, message: cause instanceof Error ? cause.message : String(cause), cause };
}

/** How one agent's JSONL files are decoded. */
export interface JsonlUsageLayout {
  readonly agent: CodingAgentId;
  /** The file to read for a target, with what the decoder needs besides the records; a failure ends the decode. */
  file(
    platform: SessionPlatform,
    target: UsageTarget,
    signal: AbortSignal | undefined
  ): Promise<Result<Omit<UsageFile, "mtimeMs">, UsageDecodeError>>;
  decoder(file: UsageFile, saved: unknown): UsageLineDecoder;
}

/** A layout's `file` for agents whose target is the file itself. */
export function sameFile(fallback: (path: string) => Omit<UsageFile, "path" | "mtimeMs">): JsonlUsageLayout["file"] {
  return async (_platform, target) => ok({ path: target.path, ...fallback(target.path) });
}

/**
 * Decodes one JSONL file line by line with the agent's decoder, keeping only the decoder's state and the records it
 * completed but the loop has not taken yet. A line that is not JSON is skipped. A last line without a newline that is
 * not JSON yet is still being written: the decode stops before it, and the cursor too. It reads no further than the
 * size the file had when the decode started.
 */
export function decodeJsonlUsage(
  platform: UsagePlatform,
  target: UsageTarget,
  layout: JsonlUsageLayout,
  options: DecodeUsageOptions = {}
): UsageStream {
  const { agent } = layout;
  const { from, signal } = options;
  let cursor = (): UsageCursor | undefined => from;
  const failure = (error: UsageDecodeError): UsageDecodeFailure => ({ agent, path: target.path, error });

  async function* run(): AsyncGenerator<UsageRecord | UsageDecodeFailure, void, undefined> {
    const io = guardIo(platform);
    try {
      signal?.throwIfAborted();
      const located = await layout.file(io.platform, target, signal);
      if (!located.ok) {
        yield failure(located.error);
        return;
      }
      const { path } = located.value;
      const info = await io.platform.fs.stat(path, { followSymlinks: true });
      if (info?.kind !== "file") {
        yield failure({ _tag: "SessionNotFound", path });
        return;
      }
      let offset = from?.offset ?? 0;
      let line = from?.line ?? 0;
      if (from && !(await continuesAt(io.platform, path, info.size, offset, signal))) {
        cursor = () => undefined;
        yield failure(sourceChanged(path, from));
        return;
      }
      const final = decodeIsFinal(options, info.mtimeMs);
      const decoder = layout.decoder({ ...located.value, mtimeMs: info.mtimeMs }, from?.state);
      const queue: UsageRecord[] = [...(from?.queue ?? [])];
      cursor = () => ({
        agent,
        offset,
        line,
        state: decoder.save(),
        ...(queue.length > 0 ? { queue: [...queue] } : {})
      });
      yield* drain(queue);
      const lines = readLines(io.platform, path, signal ? { signal } : {}, { offset, line: line + 1 }, info.size);
      for await (const text of lines) {
        const end = text.offset + text.byteLength + text.terminator.length;
        let value: unknown;
        try {
          value = text.text.trim() ? (JSON.parse(text.text) as unknown) : undefined;
        } catch {
          // A last line without a newline that is not JSON is still being written, even when the file is final for
          // now: the cursor stays before it, so the next decode reads it whole.
          if (!text.terminator) {
            break;
          }
        }
        if (value === undefined) {
          if (text.terminator) {
            offset = end;
            line = text.lineNumber;
          }
          continue;
        }
        const pushed = decoder.push({
          value,
          file: path,
          offset: text.offset,
          length: text.byteLength,
          line: text.lineNumber
        });
        if (!pushed.ok) {
          yield failure(pushed.error);
          return;
        }
        offset = end;
        line = text.lineNumber;
        queue.push(...pushed.value);
        yield* drain(queue);
      }
      queue.push(...decoder.end(final));
      yield* drain(queue);
    } catch (error) {
      signal?.throwIfAborted();
      const ioFailure = io.failure(error, target.path);
      if (!ioFailure) {
        throw error;
      }
      yield failure(ioFailure);
    }
  }

  return {
    get cursor() {
      return cursor();
    },
    [Symbol.asyncIterator]: () => run()
  };
}

/** Takes each record off the queue before yielding it, so a cursor read at the yield holds only the ones left. */
export function* drain(queue: UsageRecord[]): Generator<UsageRecord, void, undefined> {
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    yield next;
  }
}

/**
 * Whether the file still continues at a cursor's offset: it is at least that long, and the byte before it ends a
 * record, a newline or the closing brace of a last line written without one. A cheap check; a file rewritten with
 * the same byte there is not noticed.
 */
async function continuesAt(
  platform: SessionPlatform,
  path: string,
  size: number,
  offset: number,
  signal: AbortSignal | undefined
): Promise<boolean> {
  if (offset > size) {
    return false;
  }
  if (offset === 0) {
    return true;
  }
  const [byte] = await readBytes(platform, path, { start: offset - 1, end: offset }, signal ? { signal } : {});
  return byte === 0x0a || byte === 0x7d;
}

function sourceChanged(path: string, from: UsageCursor): SourceChanged {
  return { _tag: "SourceChanged", source: { file: path, offset: from.offset, length: 0, line: from.line } };
}

/** A usage stream over records that one read produces whole, such as a JSON file or a database page. */
export function usageStreamOf(
  run: (position: { cursor: () => UsageCursor | undefined }) => AsyncGenerator<UsageRecord | UsageDecodeFailure>,
  from: UsageCursor | undefined
): UsageStream {
  const position = { cursor: (): UsageCursor | undefined => from };
  return {
    get cursor() {
      return position.cursor();
    },
    [Symbol.asyncIterator]: () => run(position)
  };
}
