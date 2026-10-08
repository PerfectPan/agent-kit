import type { ContentHash } from "./content-hash.js";

/**
 * What was at an Artifact's location before harness first wrote it. Uninstall restores it from `blobRef`, which names
 * a copy the ledger repository keeps; `existed: false` means uninstall deletes the Artifact.
 */
export type PreImage =
  | { readonly existed: false }
  | { readonly existed: true; readonly hash: ContentHash; readonly blobRef: string };
