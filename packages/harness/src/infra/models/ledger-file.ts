import { err, ok, type Result } from "@rivus/agent-kit-catalog";
import * as z from "zod/mini";

import {
  type ArtifactContent,
  checkLedgerVersion,
  type InvalidLedger,
  type LedgerSnapshot,
  type LedgerVersionUnsupported
} from "../../domain/ledger/index.js";

const Locator = z.object({
  kind: z.enum(["file", "dir", "symlink", "json-entry", "toml-entry", "managed-block", "cli-registration"]),
  path: z.string(),
  pointer: z.optional(z.string()),
  member: z.optional(z.string()),
  memberIn: z.optional(z.enum(["element", "hook-group"]))
});

const Hash = z.templateLiteral(["sha256:", z.string()]);

const PreImage = z.union([
  z.object({ existed: z.literal(false) }),
  z.object({ existed: z.literal(true), hash: Hash, blobRef: z.string() })
]);

const Precondition = z.union([
  z.object({ absent: z.literal(true) }),
  z.object({ hash: Hash }),
  z.object({ ownedAt: z.number() })
]);

const Entry = z.object({
  locator: Locator,
  owners: z.array(z.string()),
  activeOwner: z.string(),
  agents: z.array(z.string()),
  bundleVersion: z.string(),
  toolVersion: z.string(),
  contentHash: Hash,
  preImage: PreImage,
  appliedAt: z.string(),
  entryRevision: z.number()
});

const Pending = z.object({
  planId: z.string(),
  owner: z.string(),
  bundleVersion: z.string(),
  toolVersion: z.string(),
  locator: Locator,
  action: z.enum(["create", "update", "adopt", "remove", "noop"]),
  agents: z.array(z.string()),
  precondition: Precondition,
  resultHash: z.optional(Hash),
  removal: z.optional(z.enum(["delete", "restore-pre-image", "release", "keep"])),
  preImage: z.optional(PreImage),
  legacy: z.optional(z.literal(true)),
  startedAt: z.string()
});

const Kept = z.object({ locator: Locator, owner: z.string(), keptAt: z.string() });

const Snapshot = z.object({
  schemaVersion: z.number(),
  lineage: z.string(),
  revision: z.number(),
  entries: z.record(z.string(), Entry),
  pending: z.array(Pending),
  kept: z.optional(z.record(z.string(), Kept))
});

/**
 * Reads a stored ledger: the version first, so that a file a newer kit wrote is refused as it is, then its shape. The
 * domain checks the invariants when it restores the snapshot.
 */
export function decodeLedger(text: string): Result<LedgerSnapshot, LedgerVersionUnsupported | InvalidLedger> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return err({ _tag: "InvalidLedger", reason: "the ledger file is not JSON" });
  }
  const version = checkLedgerVersion(json);
  if (!version.ok) {
    return version;
  }
  const parsed = Snapshot.safeParse(json);
  return parsed.success
    ? ok(parsed.data as LedgerSnapshot)
    : err({
        _tag: "InvalidLedger",
        reason: `the ledger file has an unexpected shape: ${parsed.error.issues[0]?.message}`
      });
}

export function encodeLedger(snapshot: LedgerSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

const PreImageFile = z.object({ content: z.unknown() });

/** A pre-image blob holds `{ "content": … }`, the Artifact's content as it was. */
export function decodePreImage(text: string): ArtifactContent | undefined {
  try {
    const parsed = PreImageFile.safeParse(JSON.parse(text));
    return parsed.success && parsed.data.content !== undefined ? (parsed.data.content as ArtifactContent) : undefined;
  } catch {
    return undefined;
  }
}

export function encodePreImage(content: ArtifactContent): string {
  return `${JSON.stringify({ content })}\n`;
}
