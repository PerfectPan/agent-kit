import type { ObservedArtifact } from "../spi/observed-artifact.js";

/**
 * The text of one observed Artifact that a legacy judgment matches markers against — the file's text or an entry's
 * command — and the markers of the source the find came from, which judge it instead of the bundle's markers when
 * set, so a marker one legacy source needs does not match another's finds.
 */
export interface LegacyEvidence {
  readonly text: string;
  readonly markers?: readonly string[];
}

/** The legacy evidence per observed Artifact, keyed by the observation itself. */
export type LegacyEvidenceMap = ReadonlyMap<ObservedArtifact, LegacyEvidence>;
