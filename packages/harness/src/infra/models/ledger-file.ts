import { err, ok, type Result } from "@rivus/agent-kit-catalog";
import { isPlainObject } from "es-toolkit";
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
 * The envelope of a stored ledger: the fields a store reads before the shape is known. Both are whatever the file
 * holds, so that an unknown version is reported with the value it carried and a revision of another type is still a
 * revision the save must refuse to write over.
 */
const StoredLedger = z.object({ schemaVersion: z.unknown(), revision: z.optional(z.unknown()) });

/** Reads the envelope of a stored ledger; a value that is no record reads as one without the fields. */
export function storedLedgerEnvelope(json: unknown): {
  readonly schemaVersion: unknown;
  readonly revision: unknown;
} {
  const parsed = StoredLedger.safeParse(json);
  return parsed.success
    ? { schemaVersion: parsed.data.schemaVersion, revision: parsed.data.revision }
    : { schemaVersion: undefined, revision: undefined };
}

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
  const version = checkLedgerVersion(storedLedgerEnvelope(json));
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

/**
 * What JSON holds, plus the infinities and big integers a TOML entry value can carry into a pre-image: a stored
 * Artifact's content is exactly this, so the reading layer hands it over typed. Records keep the parser's object, so
 * an own `"__proto__"` key survives the round trip.
 */
// The cast bridges zod's variance over the array members, which the schema builds mutable and the type reads readonly.
const Json = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.custom<number, unknown>((value) => typeof value === "number" && !Number.isFinite(value)),
    z.bigint(),
    z.string(),
    z.array(Json),
    // The record branch: a plain object whose values are content values, kept as the parser returned it.
    z.custom<{ readonly [key: string]: ArtifactContent | bigint }, unknown>((value) => {
      if (!isPlainObject(value)) {
        return false;
      }
      return Object.keys(value).every((key) => Json.safeParse((value as Record<string, unknown>)[key]).success);
    })
  ])
) as z.ZodMiniType<ArtifactContent | bigint>;

const PreImageFile = z.object({ content: z.optional(Json) });

/** A pre-image blob holds `{ "content": … }`, the Artifact's content as it was. A TOML big integer stays in the
 * content under the `JsonValue` type, the way a date already does. */
export function decodePreImage(text: string): ArtifactContent | undefined {
  try {
    const parsed = PreImageFile.safeParse(JSON.parse(text));
    return parsed.success ? (parsed.data.content as ArtifactContent | undefined) : undefined;
  } catch {
    return undefined;
  }
}

export function encodePreImage(content: ArtifactContent): string {
  return `${JSON.stringify({ content })}\n`;
}
