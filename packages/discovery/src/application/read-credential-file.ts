import type { AuthReading, CredentialFileFailed } from "../domain/installation/index.js";
import type { DiscoveryPlatform } from "./ports.js";
import { readSmallFile } from "./read-small-file.js";

/** Credential files are small, and `~/.claude.json` stays well below this; a larger file is not one a parser knows. */
const MAX_CREDENTIAL_BYTES = 8 * 1024 * 1024;

/**
 * Reads a credential file as JSON and hands it to `parse`, which keeps only non-secret facts; the content goes
 * nowhere else. A file that disappeared reads as absent.
 */
export async function readCredentialFile(
  platform: Pick<DiscoveryPlatform, "fs">,
  path: string,
  parse: (json: unknown) => AuthReading | undefined,
  signal: AbortSignal | undefined
): Promise<{ readonly reading: AuthReading } | { readonly problem: CredentialFileFailed } | undefined> {
  const failed = (reason: CredentialFileFailed["reason"], code?: string) => ({
    problem: { _tag: "CredentialFileFailed", path, reason, ...(code === undefined ? {} : { code }) } as const
  });
  const file = await readSmallFile(platform, path, MAX_CREDENTIAL_BYTES, signal);
  switch (file.kind) {
    case "missing":
      return undefined;
    case "too-large":
      return failed("too-large");
    case "read-failed":
      return failed("read-failed", file.code);
    default:
      break;
  }
  let json: unknown;
  try {
    json = JSON.parse(file.text);
  } catch {
    return failed("unrecognized");
  }
  const reading = parse(json);
  return reading === undefined ? failed("unrecognized") : { reading };
}
