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
      : typeof content === "object" && content !== null && !Array.isArray(content)
        ? (content as { readonly command?: unknown }).command
        : undefined;
  return typeof text === "string" && markers.some((marker) => marker.trim() !== "" && text.includes(marker));
}
