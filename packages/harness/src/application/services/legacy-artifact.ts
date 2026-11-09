import { definedFields } from "@rivus/agent-kit-catalog/public";
import * as z from "zod/mini";
import type { ArtifactContent } from "../../domain/ledger/value-objects/content-hash.js";
import { hasLegacyMarker } from "../../domain/bundle/services/legacy-markers.js";
import type { LegacyEvidence, LegacyEvidenceMap } from "../../domain/install-plan/value-objects/legacy-evidence.js";
import type { ObservedArtifact } from "../../domain/install-plan/spi/observed-artifact.js";

const commandSchema = z.object({ command: z.string() });

/** Extract only the file text or command whose shape was checked at the application boundary. */
export function legacyText(content: ArtifactContent | undefined): string | undefined {
  if (typeof content === "string") {
    return content;
  }
  const parsed = commandSchema.safeParse(content);
  return parsed.success ? parsed.data.command : undefined;
}

export function isLegacyArtifact(markers: readonly string[], content: ArtifactContent | undefined): boolean {
  const text = legacyText(content);
  return text !== undefined && hasLegacyMarker(markers, text);
}

/**
 * Keep evidence per observation: a locator's final observation and its preserved hooks need different selections.
 * `sourceMarkers` carries the markers of the source each scanned find came from, judged against it instead of the
 * bundle's markers when the source declares its own.
 */
export function legacyTexts(
  observed: readonly ObservedArtifact[],
  sourceMarkers: ReadonlyMap<ObservedArtifact, readonly string[]> = new Map()
): LegacyEvidenceMap {
  const texts = new Map<ObservedArtifact, LegacyEvidence>();
  for (const artifact of observed) {
    const text = legacyText(artifact.content);
    const markers = sourceMarkers.get(artifact);
    if (text !== undefined) {
      texts.set(artifact, definedFields({ text, markers }));
    }
  }
  return texts;
}
