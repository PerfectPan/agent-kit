/**
 * Whether the application bundle at a path may be one of `bundleIds`: `false` only when its `Contents/Info.plist` is
 * an XML property list naming another id. A binary or unreadable property list says nothing, so the path decides —
 * its bundle id comes through as `undefined`.
 */
export function appBundleMatches(id: string | undefined, bundleIds: readonly string[]): boolean {
  return id === undefined || bundleIds.includes(id);
}
