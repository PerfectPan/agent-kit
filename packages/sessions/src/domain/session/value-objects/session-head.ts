import type { ReadFailed } from "../errors/session-read-error.js";
import type { SessionRef } from "./session-ref.js";

/** What listing learns about a Session from the head and tail of its main file, without reading it fully. */
export interface SessionHead {
  ref: SessionRef;
  /** The agent's own title, else the first real prompt, cut to 80 characters. */
  title?: string;
  cwd?: string;
  startedAt?: number;
  /** The last record time seen at either end of the file, else the file's modification time. */
  lastActiveAt: number;
  sizeBytes: number;
  /** The first real user prompt, cut to 500 characters. */
  firstPrompt?: string;
}

/** Why one root or file could not be listed. Listing continues with the next one. */
export type SessionListError = { readonly _tag: "RootMissing"; readonly path: string } | ReadFailed;

export interface SessionListFailure {
  readonly ref: SessionRef;
  readonly error: SessionListError;
}

export function isSessionHead(item: SessionHead | SessionListFailure): item is SessionHead {
  return !("error" in item);
}
