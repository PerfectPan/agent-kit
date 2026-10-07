import type { LeaseStoreFailure } from "./ports.js";

export function storeFailure(
  key: string,
  reason: LeaseStoreFailure["reason"],
  message: string,
  cause?: unknown
): LeaseStoreFailure {
  return cause === undefined
    ? { _tag: "LeaseStoreFailure", key, reason, message }
    : { _tag: "LeaseStoreFailure", key, reason, message, cause };
}
