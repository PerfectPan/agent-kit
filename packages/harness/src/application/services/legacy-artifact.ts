import * as z from "zod/mini";
import type { ArtifactContent } from "../../domain/ledger/value-objects/content-hash.js";
import { hasLegacyMarker } from "../../domain/bundle/services/legacy-markers.js";
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

/** Keep evidence per observation: a locator's final observation and its preserved hooks need different selections. */
export function legacyTexts(observed: readonly ObservedArtifact[]): ReadonlyMap<ObservedArtifact, string> {
  const texts = new Map<ObservedArtifact, string>();
  for (const artifact of observed) {
    const text = legacyText(artifact.content);
    if (text !== undefined) {
      texts.set(artifact, text);
    }
  }
  return texts;
}
