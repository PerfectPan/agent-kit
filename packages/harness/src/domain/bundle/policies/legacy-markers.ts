import type { ArtifactContent } from "../../ledger/value-objects/content-hash.js";

/**
 * Whether content found at a locator is what an older version of the Owner installed before it kept a ledger: file
 * text, a string entry (such as a plugin reference) or an entry's `command` (such as one hook of a settings file's
 * hook list) that contains one of the owner's legacy markers. Address each hook on its own: a hook group can also
 * hold the user's hooks.
 */
export function isLegacyArtifact(markers: readonly string[], content: ArtifactContent | undefined): boolean {
  const text =
    typeof content === "string"
      ? content
      : content !== null && typeof content === "object" && "command" in content && typeof content.command === "string"
        ? content.command
        : undefined;
  return text !== undefined && hasLegacyMarker(markers, text);
}

/**
 * Whether text carries one of the markers, wherever markers are matched: blank markers never match, so one that is
 * only whitespace does not make every text holding a space the application's.
 */
export function hasLegacyMarker(markers: readonly string[], text: string): boolean {
  return markers.some((marker) => marker.trim() !== "" && text.includes(marker));
}
