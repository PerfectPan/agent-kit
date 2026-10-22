import { describe, expect, it } from "vite-plus/test";

import type { LedgerEntry } from "../../ledger/entities/ledger-entry.js";
import { Ledger } from "../../ledger/aggregates/ledger.js";
import { locatorKey } from "../value-objects/artifact-locator.js";
import type { ContentHash } from "../../ledger/value-objects/content-hash.js";
import type { ArtifactLocatorSnapshot } from "../value-objects/artifact-locator.js";
import type { PlanStepSnapshot } from "../value-objects/plan-step.js";
import { registrationCommands } from "./registration-commands.js";

const hash = (n: number): ContentHash => `sha256:${n.toString(16).padStart(64, "0")}`;

const registration: ArtifactLocatorSnapshot = {
  kind: "cli-registration",
  path: "/u/me/.codex/config.toml",
  pointer: "/plugins/presence"
};
const file: ArtifactLocatorSnapshot = { kind: "file", path: "/u/me/x" };

const step = (locator: ArtifactLocatorSnapshot, overrides: Partial<PlanStepSnapshot> = {}): PlanStepSnapshot => ({
  locator,
  action: "create",
  agents: ["codex"],
  precondition: { absent: true },
  capturePreImage: false,
  ...overrides
});

function entryWithAgents(agents: readonly string[]): LedgerEntry {
  const locator = { kind: "file", path: "/u/me/x" } as const;
  const restored = Ledger.restore({
    schemaVersion: 1,
    lineage: "fixture",
    revision: 1,
    pending: [],
    entries: {
      [locatorKey(locator)]: {
        locator,
        owners: ["app"],
        activeOwner: "app",
        agents,
        bundleVersion: "1",
        toolVersion: "1",
        contentHash: hash(1),
        preImage: { existed: false },
        appliedAt: "t0",
        entryRevision: 1
      }
    }
  });
  if (!restored.ok) {
    throw new Error(restored.error._tag);
  }
  return restored.value.entries()[0]!;
}

describe("registrationCommands", () => {
  it("registers what is absent and re-registers what exists with other content", () => {
    expect(registrationCommands(step(registration), undefined)).toEqual({
      agent: "codex",
      purposes: ["register"]
    });
    expect(registrationCommands(step(registration, { precondition: { hash: hash(9) } }), undefined)).toEqual({
      agent: "codex",
      purposes: ["unregister", "register"]
    });
  });

  it("unregisters a removal", () => {
    expect(
      registrationCommands(
        step(registration, { action: "remove", agents: [], precondition: { hash: hash(9) }, removal: "delete" }),
        entryWithAgents(["codex"])
      )
    ).toEqual({ agent: "codex", purposes: ["unregister"] });
  });

  it("runs no command for a restore-pre-image: the registration predates harness and stays (H5 regression)", () => {
    // The real path: the removal step carries no agents (`release`), so the agent comes from the ledger entry.
    expect(
      registrationCommands(
        step(registration, {
          action: "remove",
          agents: [],
          precondition: { hash: hash(9) },
          removal: "restore-pre-image"
        }),
        entryWithAgents(["codex"])
      )
    ).toEqual({ agent: "codex", purposes: [] });
    expect(
      registrationCommands(
        step(registration, {
          action: "remove",
          agents: [],
          precondition: { hash: hash(9) },
          removal: "restore-pre-image"
        }),
        undefined
      )
    ).toBeUndefined();
  });

  it("is undefined away from a cli-registration and when no agent can run the command line", () => {
    expect(registrationCommands(step(file), undefined)).toBeUndefined();
    expect(
      registrationCommands(
        step(registration, { action: "remove", agents: [], precondition: { hash: hash(9) }, removal: "release" }),
        undefined
      )
    ).toBeUndefined();
    expect(
      registrationCommands(
        step(registration, { action: "remove", agents: [], precondition: { hash: hash(9) }, removal: "release" }),
        entryWithAgents(["codex"])
      )
    ).toEqual({ agent: "codex", purposes: ["unregister"] });
  });
});
