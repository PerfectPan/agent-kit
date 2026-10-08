import {
  GEMINI_CLI_CHAT_FILES,
  geminiCliLegacyUsage,
  geminiCliSessionStem,
  geminiCliUsageKey,
  geminiCliUsageLines,
  geminiCliUsageRoots,
  isGeminiCliChat,
  isGeminiCliLegacyChat
} from "../../../domain/adapters/gemini-cli/index.js";
import type { UsageRecord } from "../../../domain/usage/index.js";
import { guardIo } from "../files/io-failure.js";
import { readText } from "../files/read-file.js";
import type { DecodeUsageOptions, UsageDecoder, UsagePlatform, UsageStream, UsageTarget } from "../../usage-ports.js";
import {
  belowRoot,
  decodeJsonlUsage,
  drain,
  fileSources,
  type JsonlUsageLayout,
  sameFile,
  usageStreamOf
} from "./files.js";

const AGENT = "gemini-cli";

const layout: JsonlUsageLayout = {
  agent: AGENT,
  file: sameFile((path) => ({ sessionId: geminiCliSessionStem(path) })),
  decoder: geminiCliUsageLines
};

/**
 * Every chat file under `<home>/tmp/<project>/chats/`. An older `.json` chat whose `.jsonl` sibling exists was
 * migrated into it, so only the `.jsonl` file is a source; its records keep their message ids.
 */
export const geminiCliUsageDecoder: UsageDecoder = {
  specificationVersion: "usage-v1",
  agent: AGENT,
  usageKey: geminiCliUsageKey,
  sources(platform, home, options = {}) {
    return fileSources(platform, AGENT, geminiCliUsageRoots(home), GEMINI_CLI_CHAT_FILES, {
      ...options,
      keep: (path, all) => isGeminiCliChat(path) && !(isGeminiCliLegacyChat(path) && all.has(`${path}l`)),
      identify: belowRoot
    });
  },
  decode(platform, target, options = {}) {
    return isGeminiCliLegacyChat(target.path)
      ? decodeLegacyChat(platform, target, options)
      : decodeJsonlUsage(platform, target, layout, options);
  }
};

/**
 * An older chat is one JSON object, read whole. Its cursor is the file size: the CLI no longer writes such files, and
 * one that changed since is `SourceChanged`.
 */
function decodeLegacyChat(platform: UsagePlatform, target: UsageTarget, options: DecodeUsageOptions): UsageStream {
  const { from, signal } = options;
  const path = target.path;
  return usageStreamOf(async function* (position) {
    const io = guardIo(platform);
    try {
      const info = await io.platform.fs.stat(path, { followSymlinks: true });
      if (info?.kind !== "file") {
        yield { agent: AGENT, path, error: { _tag: "SessionNotFound", path } };
        return;
      }
      if (from && from.offset !== info.size) {
        position.cursor = () => undefined;
        const source = { file: path, offset: from.offset, length: 0, line: from.line };
        yield { agent: AGENT, path, error: { _tag: "SourceChanged", source } };
        return;
      }
      const queue: UsageRecord[] = [...(from?.queue ?? [])];
      position.cursor = () => ({
        agent: AGENT,
        offset: info.size,
        line: 1,
        ...(queue.length > 0 ? { queue: [...queue] } : {})
      });
      if (!from) {
        let value: unknown;
        try {
          value = JSON.parse(await readText(io.platform, path, signal ? { signal } : {})) as unknown;
        } catch (error) {
          if (!(error instanceof SyntaxError)) {
            throw error;
          }
        }
        const source = { file: path, offset: 0, length: info.size, line: 1 };
        queue.push(
          ...geminiCliLegacyUsage(value, { path, sessionId: geminiCliSessionStem(path), mtimeMs: info.mtimeMs }, source)
        );
      }
      yield* drain(queue);
    } catch (error) {
      signal?.throwIfAborted();
      const failure = io.failure(error, path);
      if (!failure) {
        throw error;
      }
      yield { agent: AGENT, path, error: failure };
    }
  }, from);
}
