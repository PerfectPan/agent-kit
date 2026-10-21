import type { ArtifactContent } from "../../ledger/value-objects/content-hash.js";
/**
 * What a step leaves at its target once it ran: the desired content, the pre-image it restores (named by blob ref;
 * the use case reads the bytes), or nothing (a delete, a release or keep, or a ledger-only step).
 */
export type StepContentAfter = { readonly desired: ArtifactContent } | { readonly preImage: string } | undefined;
