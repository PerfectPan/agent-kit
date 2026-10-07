import type { ArtifactContent, ContentHash } from "../../ledger/value-objects/content-hash.js";
import type { ArtifactLocator } from "./artifact-locator.js";

/**
 * What is at one locator now, as the application read it; the locator's kind says what was found there. A locator
 * with nothing there is left out of the observed list. The locator follows the path convention of ArtifactLocator, so
 * a symlink at the Artifact is reported here rather than resolved away.
 */
export interface ObservedArtifact {
  readonly locator: ArtifactLocator;
  /** SHA-256 of `canonicalContent(locator.kind, content)`; something that cannot be read still gets a hash. */
  readonly hash: ContentHash;
  /**
   * The Artifact's path itself (for an entry, the file holding it) is a symlink to this target; `hash` describes what
   * the link points to.
   */
  readonly symlinkTarget?: string;
  /** The ForeignOwner, such as `chezmoi`, that manages the path. */
  readonly managedBy?: string;
  /** The content itself, needed only where an older version of the owner may have installed it. */
  readonly content?: ArtifactContent;
}
