import { appBundleMatches } from "../../domain/installation/index.js";
import type { DiscoveryPlatform } from "../ports.js";
import { readSmallFile } from "./read-small-file.js";

const MAX_INFO_PLIST_BYTES = 1024 * 1024;
const BUNDLE_ID = /<key>CFBundleIdentifier<\/key>\s*<string>([^<]*)<\/string>/;

/**
 * Reads the bundle id out of `Contents/Info.plist`, which `appBundleMatches` judges against the accepted ids; `undefined`
 * when the plist is binary or unreadable.
 */
export async function mayBeBundle(
  platform: Pick<DiscoveryPlatform, "fs">,
  path: string,
  bundleIds: readonly string[],
  signal: AbortSignal | undefined
): Promise<boolean> {
  const plist = await readSmallFile(platform, `${path}/Contents/Info.plist`, MAX_INFO_PLIST_BYTES, signal);
  const id = plist.kind === "text" ? BUNDLE_ID.exec(plist.text)?.[1]?.trim() : undefined;
  return appBundleMatches(id, bundleIds);
}
