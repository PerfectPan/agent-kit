import type { CodingAgentId } from "@rivus/agent-kit-catalog/public";
import type { ArtifactLocatorSnapshot } from "./artifact-locator.js";
import type { TrustPromptKind } from "../spi/trust-prompt.js";

/** A confirmation the agent will ask the user for after installation. A plan announces it and never approves it. */
export interface TrustPrompt {
  readonly agent: CodingAgentId;
  readonly kind: TrustPromptKind;
  readonly locator: ArtifactLocatorSnapshot;
}
