import { describe, expect, it } from "vite-plus/test";

import { ArtifactSpec } from "./artifact-spec.js";
import { Bundle, type BundleSnapshot } from "./bundle.js";
import { Owner } from "./owner.js";
import { RegistrationState } from "./registration-state.js";

const input = (): BundleSnapshot => ({
  owner: "example",
  version: "1",
  digest: "digest",
  artifacts: [{ type: "skill", name: "example", files: { "SKILL.md": "original" } }],
  legacyMarkers: ["example-hook"]
});

describe("bundle value objects", () => {
  it("restores detached values and returns the unchanged plain shape", () => {
    const snapshot = input();
    const result = Bundle.restore(snapshot);
    if (!result.ok) {
      throw new Error(result.error.reason);
    }
    expect(result.value.toSnapshot()).toEqual(snapshot);
    expect(result.value.owner).toBeInstanceOf(Owner);
    expect(result.value.owner.toSnapshot()).toBe("example");
    expect(result.value.artifacts[0]).toBeInstanceOf(ArtifactSpec);
    expect(result.value.legacyMarkers()).toEqual(["example-hook"]);
    expect(Object.getPrototypeOf(result.value.toSnapshot())).toBe(Object.prototype);
    expect(Object.isFrozen(snapshot.artifacts[0])).toBe(false);
    expect(Object.isFrozen(snapshot.legacyMarkers)).toBe(false);
    const spec = result.value.artifacts[0]!.toSnapshot();
    if (spec.type !== "skill") {
      throw new Error("expected skill");
    }
    expect(Object.isFrozen(spec.files)).toBe(true);
    expect(spec).not.toBe(snapshot.artifacts[0]);
  });

  it("preserves rejection precedence and does not freeze earlier valid children when a later child fails", () => {
    const snapshot = input();
    const rejected = {
      ...snapshot,
      artifacts: [...snapshot.artifacts, { type: "hooks" as const, command: " ", events: {} }]
    };
    expect(Bundle.restore(rejected)).toEqual({
      ok: false,
      error: { _tag: "InvalidBundle", reason: "hook command is empty" }
    });
    expect(Object.isFrozen(rejected.artifacts[0])).toBe(false);
    expect(Object.isFrozen(rejected.artifacts)).toBe(false);
    expect(Bundle.restore({ ...rejected, owner: "BAD OWNER", version: "" })).toEqual({
      ok: false,
      error: { _tag: "InvalidBundle", reason: 'owner "BAD OWNER" is not a package-style name' }
    });
    expect(Bundle.restore({ ...rejected, version: "", legacyMarkers: [""] })).toEqual({
      ok: false,
      error: { _tag: "InvalidBundle", reason: "version and digest must not be empty" }
    });
    expect(Bundle.restore({ ...rejected, legacyMarkers: [""] })).toEqual({
      ok: false,
      error: { _tag: "InvalidBundle", reason: "an empty legacy marker would match everything" }
    });
  });

  it("keeps missing and null legacy-marker fields as supplied by JavaScript callers", () => {
    const omitted = { owner: "example", version: "1", digest: "d", artifacts: [] };
    const absent = Bundle.restore(omitted);
    expect(absent.ok && absent.value.toSnapshot()).toEqual(omitted);
    expect(absent.ok && absent.value.legacyMarkers()).toEqual([]);
    const nullable = { ...omitted, legacyMarkers: null } as unknown as BundleSnapshot;
    const result = Bundle.restore(nullable);
    expect(result.ok && result.value.toSnapshot()).toEqual(nullable);
    expect(result.ok && result.value.legacyMarkers()).toEqual([]);
  });

  it("retains a detached immutable registration read", () => {
    const copy = { isFile: true, content: { nested: ["original"] } };
    const state = RegistrationState.observe(true, { installedCopy: "/copy", copy });
    expect(Object.isFrozen(copy.content)).toBe(false);
    copy.content.nested.push("later");
    expect(state.content()).toEqual({ nested: ["original"] });
    expect(Object.isFrozen(copy.content)).toBe(false);
    expect(Object.isFrozen(state.content())).toBe(true);
  });
});
