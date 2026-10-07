import {
  type ArtifactContent,
  type ArtifactLocator,
  canonicalContent,
  type ContentHash,
  Ledger,
  LEDGER_SCHEMA_VERSION,
  type LedgerEntry,
  type LedgerSnapshot,
  locatorKey,
  type PendingOperation
} from "@rivus/agent-kit-harness";

/**
 * A deterministic stand-in for SHA-256 in fixtures: FNV-1a over the text's UTF-16 code units with eight seeds, as 64
 * hex digits. It only tells fixture contents apart; it is not a cryptographic hash.
 */
export function fixtureHash(text: string): ContentHash {
  let hex = "";
  for (let seed = 0; seed < 8; seed++) {
    let hash = (0x811c9dc5 ^ Math.imul(seed, 0x9e3779b9)) >>> 0;
    for (let index = 0; index < text.length; index++) {
      hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
    }
    hex += hash.toString(16).padStart(8, "0");
  }
  return `sha256:${hex}`;
}

/** `fixtureHash` of the canonical form of an Artifact's content, as a real caller would hash it with SHA-256. */
export function fixtureContentHash(locator: ArtifactLocator, content: ArtifactContent): ContentHash {
  return fixtureHash(canonicalContent(locator.kind, content));
}

/** A LedgerEntry with defaults for everything but the locator; `content` stands in for `contentHash`. */
export interface LedgerEntryFixture extends Partial<Omit<LedgerEntry, "locator">> {
  readonly locator: ArtifactLocator;
  readonly content?: ArtifactContent;
}

export interface LedgerFixture {
  readonly schemaVersion?: number;
  readonly lineage?: string;
  /** Defaults to the highest entry revision. */
  readonly revision?: number;
  readonly entries?: readonly LedgerEntryFixture[];
  readonly pending?: readonly PendingOperation[];
}

const FIXTURE_OWNER = "fixture-owner";

export function ledgerEntryFixture(fixture: LedgerEntryFixture): LedgerEntry {
  const { content, ...entry } = fixture;
  const owners = entry.owners ?? [entry.activeOwner ?? FIXTURE_OWNER];
  return {
    owners,
    activeOwner: owners[0] ?? FIXTURE_OWNER,
    agents: ["claude-code"],
    bundleVersion: "1.0.0",
    toolVersion: "0.0.0",
    contentHash: fixtureContentHash(fixture.locator, content ?? ""),
    preImage: { existed: false },
    appliedAt: "2026-01-01T00:00:00.000Z",
    entryRevision: 0,
    ...entry
  };
}

/** The data `ledgerFixture` restores; use it as it is for data a Ledger refuses, such as an unknown schema version. */
export function ledgerSnapshotFixture(fixture: LedgerFixture = {}): LedgerSnapshot {
  const entries = (fixture.entries ?? []).map(ledgerEntryFixture);
  return {
    schemaVersion: fixture.schemaVersion ?? LEDGER_SCHEMA_VERSION,
    lineage: fixture.lineage ?? "fixture-lineage",
    revision: fixture.revision ?? Math.max(0, ...entries.map((entry) => entry.entryRevision)),
    entries: Object.fromEntries(entries.map((entry) => [locatorKey(entry.locator), entry])),
    pending: fixture.pending ?? []
  };
}

/** An in-memory Ledger; throws when the fixture breaks a ledger invariant. */
export function ledgerFixture(fixture: LedgerFixture = {}): Ledger {
  const restored = Ledger.restore(ledgerSnapshotFixture(fixture));
  if (!restored.ok) {
    throw new Error(`Invalid ledger fixture: ${JSON.stringify(restored.error)}`);
  }
  return restored.value;
}
