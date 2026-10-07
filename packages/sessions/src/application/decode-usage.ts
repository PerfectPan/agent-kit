import { AgentKitError, type CodingAgentId, parseCodingAgentId } from "@rivus/agent-kit-catalog";
import type { Platform } from "@rivus/agent-kit-platform";

import type { UsageRecord } from "../domain/usage/index.js";
import { adapterHome, selectAdapters } from "./adapter-table.js";
import type { SessionErrorCode } from "./errors.js";
import { builtinUsageDecoders } from "./usage-decoders/index.js";
import type {
  DecodeUsageOptions,
  UsageCursor,
  UsageDecodeFailure,
  UsageDecoders,
  UsagePlatform,
  UsageSource,
  UsageSourceFailure,
  UsageSourceOptions,
  UsageStream,
  UsageTarget
} from "./usage-ports.js";

/**
 * Streams the usage records of one source of `agent` (a file, a session directory or opencode's database) in source
 * order. Memory does not grow with the source: the decoder keeps only the state its agent's rules carry between
 * records. The stream's `cursor`, passed back as `from`, continues where it stopped, so a source that grows is read
 * once, and a file decoded in steps gives the records one decode gives. Requests that may still get records where the
 * source ends are reported only with `final` (see `DecodeUsageOptions`). Expected failures are items, such as
 * `CapabilityUnsupported` for an agent without a decoder; a cursor of another agent throws `invalid-cursor`. An abort
 * rejects with `signal.reason`.
 */
export function decodeUsage(
  platform: UsagePlatform,
  agent: CodingAgentId,
  target: UsageTarget,
  options: DecodeUsageOptions = {}
): UsageStream {
  const table: UsageDecoders = builtinUsageDecoders;
  const parsed = parseCodingAgentId(agent);
  const id = parsed.ok ? parsed.value : agent;
  const decoder = table[id];
  const { from, since, until, signal } = options;
  if (!decoder) {
    const failure: UsageDecodeFailure = {
      agent: id,
      path: target.path,
      error: { _tag: "CapabilityUnsupported", agent: id }
    };
    return {
      cursor: from,
      async *[Symbol.asyncIterator]() {
        signal?.throwIfAborted();
        yield failure;
      }
    };
  }
  if (from && from.agent !== decoder.agent) {
    throw new AgentKitError<SessionErrorCode>(
      "invalid-cursor",
      `A cursor of "${from.agent}" cannot continue a decode of "${decoder.agent}"`
    );
  }
  const inner = decoder.decode(platform, target, {
    ...(from ? { from } : {}),
    ...(since === undefined ? {} : { since }),
    ...(options.final ? { final: true } : {}),
    ...(options.quietBefore === undefined ? {} : { quietBefore: options.quietBefore }),
    ...(signal ? { signal } : {})
  });
  let stoppedAt: UsageCursor | undefined;
  return {
    get cursor() {
      return stoppedAt ?? inner.cursor;
    },
    async *[Symbol.asyncIterator]() {
      for await (const item of inner) {
        if ("error" in item) {
          yield item;
          continue;
        }
        if (until !== undefined && item.timestamp >= until) {
          // The record goes back into the cursor's queue, so the decode that continues starts with it.
          const at = inner.cursor;
          stoppedAt = {
            ...(at ?? { agent: decoder.agent, offset: 0, line: 0 }),
            queue: [item, ...(at?.queue ?? [])]
          };
          return;
        }
        if (since === undefined || item.timestamp >= since) {
          yield item;
        }
      }
    }
  };
}

export interface ListUsageSourcesOptions extends UsageSourceOptions {
  /** Agents to list, by id or alias; defaults to every agent with a usage decoder. */
  readonly agents?: readonly CodingAgentId[];
}

/**
 * Lists the usage sources of each agent under its home (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GEMINI_CLI_HOME`,
 * `XDG_DATA_HOME`, `PI_CODING_AGENT_DIR` and the other home rules of catalog apply), leaving out those last modified
 * before `since`. A missing root or an unreadable directory is a failure item and listing goes on. Throws
 * `capability-unsupported` when a requested agent has no decoder; leaving the loop stops the reads.
 */
export async function* listUsageSources(
  platform: UsagePlatform & Pick<Platform, "env" | "home">,
  options: ListUsageSourcesOptions = {}
): AsyncGenerator<UsageSource | UsageSourceFailure, void, undefined> {
  const table: UsageDecoders = builtinUsageDecoders;
  const decoders = selectAdapters(table, options.agents ?? Object.keys(table), "usage decoder");
  const sourceOptions = {
    ...(options.since === undefined ? {} : { since: options.since }),
    ...(options.signal ? { signal: options.signal } : {})
  };
  for (const decoder of decoders) {
    options.signal?.throwIfAborted();
    yield* decoder.sources(platform, adapterHome(decoder, platform, "usage decoder"), sourceOptions);
  }
}

/** Whether a stream item is a record rather than a failure. */
export function isUsageRecord(item: UsageRecord | UsageDecodeFailure | UsageSourceFailure): item is UsageRecord {
  return !("error" in item);
}

/** Whether a listing item is a source rather than a failure. */
export function isUsageSource(item: UsageSource | UsageSourceFailure): item is UsageSource {
  return !("error" in item);
}
