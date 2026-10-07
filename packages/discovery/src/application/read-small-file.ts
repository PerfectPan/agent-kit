import type { DiscoveryPlatform } from "./ports.js";
import { abortable, errnoCode } from "./abortable.js";

/** What reading a small file gave: its text, or why there is none. */
export type SmallFile =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "missing" }
  | { readonly kind: "too-large" }
  | { readonly kind: "read-failed"; readonly code: string };

/**
 * Reads at most `maxBytes` of a file as UTF-8. A file that disappeared is `missing`; another file system error (an
 * errno `code`) is `read-failed`; anything else is a defect and rejects. An abort rejects with `signal.reason`, even
 * while a read hangs.
 */
export async function readSmallFile(
  platform: Pick<DiscoveryPlatform, "fs">,
  path: string,
  maxBytes: number,
  signal: AbortSignal | undefined
): Promise<SmallFile> {
  const decoder = new TextDecoder();
  const chunks = platform.fs.read(path, { start: 0, end: maxBytes + 1 })[Symbol.asyncIterator]();
  let text = "";
  let bytes = 0;
  try {
    for (let next = await abortable(chunks.next(), signal); !next.done; next = await abortable(chunks.next(), signal)) {
      bytes += next.value.byteLength;
      text += decoder.decode(next.value, { stream: true });
    }
  } catch (error) {
    void chunks.return?.()?.catch(() => undefined);
    signal?.throwIfAborted();
    const code = errnoCode(error);
    if (code === undefined) {
      throw error;
    }
    return code === "ENOENT" ? { kind: "missing" } : { kind: "read-failed", code };
  }
  signal?.throwIfAborted();
  return bytes > maxBytes ? { kind: "too-large" } : { kind: "text", text: text + decoder.decode() };
}
