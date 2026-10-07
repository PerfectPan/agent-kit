import { err, ok, type Result } from "@rivus/agent-kit/catalog";

import type { FenceRejected } from "../errors/fence-rejected.js";
import type { FencingToken } from "../value-objects/fencing-token.js";
import type { LeaseSnapshot } from "../value-objects/lease-snapshot.js";

/** The token the next acquisition of `key` receives: one generation above the record, 1 for a new key. */
export function nextFencingToken(current: LeaseSnapshot | undefined, key: string): FencingToken {
  return { key, generation: (current?.generation ?? 0) + 1 };
}

/**
 * The check a protected resource runs inside its own atomic write: `lastSeen` is the highest token it has accepted
 * for the key. A smaller generation is refused; an equal one is the same holder writing again. On success, store the
 * returned token as the new `lastSeen`.
 */
export function checkFence(
  lastSeen: FencingToken | undefined,
  token: FencingToken
): Result<FencingToken, FenceRejected> {
  if (lastSeen !== undefined && lastSeen.key === token.key && token.generation < lastSeen.generation) {
    return err({ _tag: "FenceRejected", key: token.key, generation: token.generation, current: lastSeen.generation });
  }
  return ok(token);
}
