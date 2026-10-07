import type { CodingAgentId } from "@rivus/agent-kit-catalog";

import type { ArtifactLocator } from "./artifact-locator.js";

/**
 * `hook-review`: the agent asks the user to review a new or changed hook (agents that record trust by content hash).
 * `plugin-consent`: the agent asks before it enables an installed plugin or extension. `folder-trust`: hooks wait
 * until the user trusts the folder.
 */
export type TrustPromptKind = "hook-review" | "plugin-consent" | "folder-trust";

/** A confirmation the agent will ask the user for after installation. A plan announces it and never approves it. */
export interface TrustPrompt {
  readonly agent: CodingAgentId;
  readonly kind: TrustPromptKind;
  readonly locator: ArtifactLocator;
}
