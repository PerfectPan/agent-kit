import type { LeaseRepositoryFailure, RevisionConflict } from "../ports.js";

export function repositoryFailure(
  key: string,
  reason: LeaseRepositoryFailure["reason"],
  message: string,
  cause?: unknown
): LeaseRepositoryFailure {
  return cause === undefined
    ? { _tag: "LeaseRepositoryFailure", key, reason, message }
    : { _tag: "LeaseRepositoryFailure", key, reason, message, cause };
}

export function revisionConflict(
  key: string,
  expectedRevision: number | undefined,
  storedRevision: number | undefined
): RevisionConflict {
  return { _tag: "RevisionConflict", key, expectedRevision, storedRevision };
}
