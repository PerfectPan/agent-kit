import type { Platform } from "@rivus/agent-kit-platform";

/** Whether `cause` says that nothing is at the path (or a parent is not a directory). */
export function isMissing(cause: unknown): boolean {
  const code = typeof cause === "object" && cause !== null ? (cause as { code?: unknown }).code : undefined;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** The UTF-8 text of a file, or `undefined` when it does not exist. */
export async function readText(platform: Pick<Platform, "fs">, path: string): Promise<string | undefined> {
  const decoder = new TextDecoder();
  let text = "";
  try {
    for await (const chunk of platform.fs.read(path)) {
      text += decoder.decode(chunk, { stream: true });
    }
  } catch (cause) {
    if (isMissing(cause)) {
      return undefined;
    }
    throw cause;
  }
  return text + decoder.decode();
}
