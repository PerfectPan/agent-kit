import type { CodingAgentId } from "@rivus/agent-kit-catalog/public";

import type { Strategy } from "../../bundle/spi/strategy.js";
import type { ArtifactContent, ContentHash } from "../../ledger/value-objects/content-hash.js";
import type { ArtifactLocatorSnapshot } from "../value-objects/artifact-locator.js";
import type { TrustPromptKind } from "./trust-prompt.js";

/** One Artifact of a Bundle as an agent's strategy renders it: where it goes and what it holds. */
export interface DesiredArtifact {
  readonly agent: CodingAgentId;
  readonly locator: ArtifactLocatorSnapshot;
  readonly content: ArtifactContent;
  /** SHA-256 of `canonicalContent(locator.kind, content)`, computed by the caller. */
  readonly hash: ContentHash;
  readonly strategy: Strategy;
  /** The confirmation the agent asks for when this content is new or changed. */
  readonly trust?: TrustPromptKind;
}
