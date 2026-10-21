/**
 * Whether text carries one of the markers, wherever markers are matched: blank markers never match, so one that is
 * only whitespace does not make every text holding a space the application's.
 */
export function hasLegacyMarker(markers: readonly string[], text: string): boolean {
  return markers.some((marker) => marker.trim() !== "" && text.includes(marker));
}
