/**
 * A source last written longer ago than this is complete. Claude Code writes a response's records within minutes of
 * each other (the longest gap in the logs we have read is under 12 minutes), so the requests still open where such a
 * file ends get no more records.
 */
export const QUIET_MS: number = 30 * 60 * 1000;

/** Whether a source last written at `mtimeMs` is quiet at `now`: nothing was written into it for a while. */
export function isQuiet(mtimeMs: number, now: number): boolean {
  return mtimeMs < now - QUIET_MS;
}

/**
 * Whether a decode treats its source as complete: the caller said so, or the source was quiet when the decode looked
 * at it — its modification time is before `quietBefore`. A complete source reports the requests that could still get
 * records where it ends; otherwise they stay in the cursor for a later decode to decide.
 */
export function decodeIsFinal(
  options: { readonly final?: boolean; readonly quietBefore?: number },
  mtimeMs: number
): boolean {
  return options.final === true || (options.quietBefore !== undefined && mtimeMs < options.quietBefore);
}
