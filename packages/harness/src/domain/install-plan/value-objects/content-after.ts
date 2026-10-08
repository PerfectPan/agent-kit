import type { ArtifactContent } from "../../ledger/value-objects/content-hash.js";
import type { PreImage } from "../../ledger/value-objects/pre-image.js";
import type { PlanStep } from "./plan-step.js";

/**
 * What a step leaves at its target once it ran: the desired content, the pre-image it restores (named by blob ref;
 * the use case reads the bytes), or nothing (a delete, a release or keep, or a ledger-only step).
 */
export type StepContentAfter = { readonly desired: ArtifactContent } | { readonly preImage: string } | undefined;

/**
 * The content a step leaves behind, expressed the same way the ledger's pending reconciliation is: a non-removal
 * leaves its desired content; a `restore-pre-image` of something that existed leaves that pre-image; anything else
 * leaves nothing. The use case fetches the pre-image's bytes from the store.
 */
export function contentAfterStep(step: PlanStep, preImage: PreImage | undefined): StepContentAfter {
  if (step.action !== "remove") {
    return step.desired === undefined ? undefined : { desired: step.desired.content };
  }
  return step.removal === "restore-pre-image" && preImage?.existed === true
    ? { preImage: preImage.blobRef }
    : undefined;
}
