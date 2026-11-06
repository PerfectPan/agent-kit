import { ok, type Result } from "@rivus/agent-kit-catalog/spi";
import { GEMINI_CLI_DISPLAY_NAME, GEMINI_CLI_ID } from "./facts.js";
import { GEMINI_CLI_CHAT_FILES, isGeminiCliChat, isGeminiCliLegacyChat, geminiCliUsageRoots } from "./layout.js";
import { GEMINI_CLI_CAPABILITIES, geminiCapabilities, translateGeminiCliRecords } from "./sessions/events.js";
import { previewGeminiCliRecords } from "./sessions/preview.js";
import { geminiCliLegacyChat } from "./usage.js";
import {
  catchIoFailure,
  createTranscript,
  discoverSessions,
  type LoadOptions,
  type SessionAdapter,
  type SessionPlatform,
  type SessionReadError,
  type SessionRef,
  type SkippedRecord,
  type SourcedRecord,
  type Transcript,
  readJsonlRecords,
  readText
} from "@rivus/agent-kit-sessions/spi";

/** A chat file's records, the input that is not JSON, and the session id a `.json` chat's object carries. */
interface ChatFile {
  records: SourcedRecord[];
  skipped: SkippedRecord[];
  legacySessionId?: string | undefined;
}

/**
 * Reads a chat file's records: a `.jsonl` chat is one record per line, an older `.json` chat is one object with a
 * `messages` array whose entries become per-line records, each carrying the whole file as its source and the
 * message's index as its line.
 */
function readChatRecords(
  platform: SessionPlatform,
  path: string,
  options: LoadOptions
): Promise<Result<ChatFile, SessionReadError>> {
  return catchIoFailure(platform, path, options.signal, async (guarded): Promise<ChatFile> => {
    if (!isGeminiCliLegacyChat(path)) {
      return readJsonlRecords(guarded, path, options);
    }
    const text = await readText(guarded, path, options);
    const source = { file: path, offset: 0, length: new TextEncoder().encode(text).byteLength, line: 1 };
    let value: unknown;
    try {
      value = JSON.parse(text) as unknown;
    } catch {
      return { records: [], skipped: [{ reason: "invalid-json", source }] };
    }
    const chat = geminiCliLegacyChat(value);
    return {
      records: (chat?.messages ?? []).map((message, index) => ({ ...source, line: index + 1, value: message })),
      skipped: [],
      legacySessionId: chat?.sessionId
    };
  });
}

/**
 * Loads one chat: every record translates in file order, the legacy session id wins when the chat carries one, and
 * the transcript lists what the records show.
 */
async function loadGeminiCli(
  platform: SessionPlatform,
  ref: SessionRef,
  options: LoadOptions = {}
): Promise<Result<Transcript, SessionReadError>> {
  const read = await readChatRecords(platform, ref.path, options);
  if (!read.ok) {
    return read;
  }
  const { records, skipped, legacySessionId } = read.value;
  const translated = translateGeminiCliRecords(records, { sessionId: legacySessionId ?? ref.sessionId });
  if (!translated.ok) {
    return translated;
  }
  translated.value.skipped.push(...skipped);
  options.signal?.throwIfAborted();
  return ok(createTranscript(GEMINI_CLI_ID, geminiCapabilities(translated.value.events), translated.value));
}

/** A chat file is this agent's session when it is a chat file at all. */
async function detectGeminiCli(platform: SessionPlatform, ref: SessionRef): Promise<boolean> {
  const info = await platform.fs.stat(ref.path, { followSymlinks: true });
  return info?.kind === "file" && isGeminiCliChat(ref.path);
}

/**
 * Lists the chats under one of the home's `tmp/` project directories. A legacy `.json` chat whose `.jsonl` sibling
 * exists is skipped: the CLI migrated that chat into the sibling, whose records keep the message ids.
 */
async function* discoverGeminiCli(
  platform: SessionPlatform,
  root: string,
  options: { signal?: AbortSignal; onTotal?: (files: number) => void } = {}
) {
  for await (const head of discoverSessions(platform, GEMINI_CLI_ID, root, {
    ...options,
    files: GEMINI_CLI_CHAT_FILES,
    preview: previewGeminiCliRecords
  })) {
    if (
      "ref" in head &&
      isGeminiCliLegacyChat(head.ref.path) &&
      (await platform.fs.stat(`${head.ref.path}l`, { followSymlinks: true }))?.kind === "file"
    ) {
      continue;
    }
    yield head;
  }
}

export const geminiCliSessionAdapter: SessionAdapter = {
  specificationVersion: "sessions-v1",
  agent: GEMINI_CLI_ID,
  displayName: GEMINI_CLI_DISPLAY_NAME,
  capabilities: GEMINI_CLI_CAPABILITIES,
  roots: geminiCliUsageRoots,
  discover: discoverGeminiCli,
  detect: detectGeminiCli,
  load: loadGeminiCli
};
