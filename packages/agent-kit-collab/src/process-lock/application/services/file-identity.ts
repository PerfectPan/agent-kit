import type { FileStat } from "@rivus/agent-kit/platform";

/**
 * Whether two stat readings name the same file: the device, the inode and the birth time all equal. Birth time at
 * nanosecond resolution keeps the identity of a freed inode from recurring when a successor takes its number at the
 * same path, so a lock that compares the file it locked against a reading taken before its open does not hand the lock
 * to a waiter that locked an unlinked inode. A reading without a path (the file is missing), without an identity (the
 * platform does not know one), or of a different file matches nothing, so a verification against it always fails.
 */
export function sameFileIdentity(before: FileStat | undefined, after: FileStat | undefined): boolean {
  const a = before?.identity;
  const b = after?.identity;
  return a !== undefined && b !== undefined && a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
}
