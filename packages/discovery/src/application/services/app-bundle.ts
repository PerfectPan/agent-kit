import type { DiscoveryPlatform } from "../ports.js";
import { readSmallFile } from "./read-small-file.js";

const MAX_INFO_PLIST_BYTES = 1024 * 1024;
const BUNDLE_ID = /<key>CFBundleIdentifier<\/key>\s*<string>([^<]*)<\/string>/;

/**
 * Whether the application bundle at `path` may be one of `bundleIds`: `false` only when its `Contents/Info.plist` is
 * an XML property list naming another id. A binary or unreadable property list says nothing, so the path decides.
 */
export async function mayBeBundle(
  platform: Pick<DiscoveryPlatform, "fs">,
  path: string,
  bundleIds: readonly string[],
  signal: AbortSignal | undefined
): Promise<boolean> {
  const plist = await readSmallFile(platform, `${path}/Contents/Info.plist`, MAX_INFO_PLIST_BYTES, signal);
  const id = plist.kind === "text" ? BUNDLE_ID.exec(plist.text)?.[1]?.trim() : undefined;
  return id === undefined || bundleIds.includes(id);
}
