import { err, ok, type Result } from "@rivus/agent-kit-catalog";

import type { ReadFailed, SessionNotFound } from "../../domain/session/index.js";
import type { SourceChanged, SourcePointer } from "../../domain/transcript/index.js";
import { catchIoFailure } from "../services/files/io-failure.js";
import { readBytes } from "../services/files/read-file.js";
import type { SessionPlatform } from "../ports.js";

export type ReadOriginalError = SourceChanged | SessionNotFound | ReadFailed;

/**
 * Reads an event's record back from its source pointer and parses it. `SourceChanged` means those bytes are no
 * longer one JSON value, because the file changed after the transcript was loaded. An abort rejects with
 * `signal.reason`; only defects throw.
 */
export async function readOriginal(
  platform: SessionPlatform,
  source: SourcePointer,
  options: { readonly signal?: AbortSignal } = {}
): Promise<Result<unknown, ReadOriginalError>> {
  const bytes = await catchIoFailure(platform, source.file, options.signal, (guarded) =>
    readBytes(guarded, source.file, { start: source.offset, end: source.offset + source.length }, options)
  );
  if (!bytes.ok) {
    return bytes;
  }
  try {
    return ok(JSON.parse(new TextDecoder().decode(bytes.value)) as unknown);
  } catch {
    return err({ _tag: "SourceChanged", source });
  }
}
