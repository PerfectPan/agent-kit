import type { ContentHash } from "../value-objects/content-hash.js";
import type { PendingOperation, PendingResolution } from "../entities/pending-operation.js";

/** What the target holds once the operation is done: a hash, nothing, or anything because the disk is not involved. */
function expectedAfter(op: PendingOperation): ContentHash | "absent" | "any" {
  if (op.action !== "remove") {
    return op.resultHash ?? "any";
  }
  switch (op.removal) {
    case "release":
    case "keep":
      return "any";
    case "restore-pre-image":
      return op.preImage?.existed === true ? op.preImage.hash : "absent";
    default:
      return "absent";
  }
}

/**
 * Decides from a probe of the target whether a pending operation happened, instead of replaying it: the state the
 * step leaves wins over the state its precondition expects, so a step whose before and after look the same counts as
 * completed.
 */
export function reconcilePending(op: PendingOperation, actual: ContentHash | undefined): PendingResolution {
  const after = expectedAfter(op);
  if (after === "any" || (after === "absent" ? actual === undefined : actual === after)) {
    return "completed";
  }
  const before = op.precondition;
  if ("ownedAt" in before) {
    return "completed";
  }
  return ("absent" in before ? actual === undefined : actual === before.hash) ? "not-started" : "unknown";
}
