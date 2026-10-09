import * as z from "zod/mini";

import type { Platform } from "@rivus/agent-kit-platform";

/** The codes of "nothing is at the path (or a parent is not a directory)". */
const Missing = z.looseObject({ code: z.union([z.literal("ENOENT"), z.literal("ENOTDIR")]) });

/** Whether `cause` says that nothing is at the path (or a parent is not a directory). */
export function isMissing(cause: unknown): boolean {
  return Missing.safeParse(cause).success;
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
