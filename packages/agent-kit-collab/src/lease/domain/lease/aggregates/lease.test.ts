import { describe, expect, it } from "vite-plus/test";

import { type LeaseTimingInput, LeaseTiming } from "../value-objects/lease-timing.js";
import { Holder, type HolderSnapshot } from "../value-objects/holder.js";
import type { LeaseSnapshot } from "../value-objects/lease-snapshot.js";
import { Lease, type LeaseClaim } from "./lease.js";

import { FencingToken } from "../value-objects/fencing-token.js";

function restored(snapshot: LeaseSnapshot): Lease {
  const result = Lease.restore(snapshot);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

function timing(ttlMs: number): LeaseTiming {
  const result = LeaseTiming.create({ ttlMs, heartbeatMs: ttlMs / 2 });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

const KEY = "task:1";
const host = { host: "box", bootId: "boot-1" };
const holderA: HolderSnapshot = { ...host, pid: 10, startTime: 1000 };
const holderB: HolderSnapshot = { ...host, pid: 20, startTime: 2000 };
const claim = (holder: HolderSnapshot, holderId: string, now = 0): LeaseClaim => ({
  key: KEY,
  holder: new Holder(holder),
  holderId,
  now
});
const alive = { fresh: true, liveness: "alive" } as const;

describe("Lease", () => {
  it("S37: never moves the generation back: release leaves a tombstone and the next holder goes one further", () => {
    const created = Lease.create(claim(holderA, "a1"));
    expect(created.state.toSnapshot()).toMatchObject({ generation: 1, revision: 1, holderId: "a1" });

    const released = created.state.release({ holderId: "a1", generation: 1 }, 5);
    if (!released.ok) {
      throw new Error("release refused");
    }
    expect(released.value.state.toSnapshot()).toEqual({
      key: KEY,
      generation: 1,
      revision: 2,
      holder: null,
      holderId: null,
      renewedAt: 5
    });

    const again = released.value.state.acquire(claim(holderA, "a2"), { fresh: false, liveness: "unknown" });
    expect(again.ok && again.value.state.toSnapshot()).toMatchObject({ generation: 2, revision: 3, holderId: "a2" });
  });

  it("refuses a live, fresh holder and takes over a dead or silent one, moving the generation on", () => {
    const lease = Lease.create(claim(holderA, "a1")).state;
    expect(lease.acquire(claim(holderB, "b1"), alive)).toEqual({
      ok: false,
      error: { _tag: "LeaseHeld", key: KEY, generation: 1, holder: holderA, holderId: "a1" }
    });
    for (const view of [
      { fresh: true, liveness: "dead" },
      { fresh: false, liveness: "alive" },
      { fresh: false, liveness: "unknown" }
    ] as const) {
      const taken = lease.acquire(claim(holderB, "b1"), view);
      expect(taken.ok && taken.value.state.toSnapshot()).toMatchObject({ generation: 2, holder: holderB });
      expect(taken.ok && taken.value.events).toEqual([
        { _tag: "LeaseAcquired", key: KEY, generation: 2, holderId: "b1", previousHolderId: "a1" }
      ]);
    }
  });

  it("renews and releases only for the holding acquisition, and says why it was lost", () => {
    const lease = Lease.create(claim(holderA, "a1")).state;
    const holding = { holderId: "a1", generation: 1 };
    expect(lease.holds(holding)).toBe(true);
    expect(lease.lossOf(holding)).toBeUndefined();
    const renewed = lease.renew(holding, 7);
    expect(renewed.ok && renewed.value.state.toSnapshot()).toMatchObject({ generation: 1, revision: 2, renewedAt: 7 });

    // ABA: the same process, holding again under a new acquisition, is not the old holding.
    const taken = lease.acquire(claim(holderA, "a2"), { fresh: false, liveness: "alive" });
    const successor = taken.ok ? taken.value.state : lease;
    expect(successor.renew({ holderId: "a1", generation: 1 }, 8)).toEqual({
      ok: false,
      error: { _tag: "LeaseLost", key: KEY, generation: 1, reason: "taken-over" }
    });
    expect(successor.holds({ holderId: "a1", generation: 1 })).toBe(false);
    expect(successor.lossOf({ holderId: "a1", generation: 1 })).toEqual({
      _tag: "LeaseLost",
      key: KEY,
      generation: 1,
      reason: "taken-over"
    });
    const tombstone = successor.release({ holderId: "a2", generation: 2 }, 9);
    expect(tombstone.ok && tombstone.value.state.release({ holderId: "a2", generation: 2 }, 10)).toEqual({
      ok: false,
      error: { _tag: "LeaseLost", key: KEY, generation: 2, reason: "released" }
    });
  });

  it("restores only records that keep the invariants", () => {
    const valid: LeaseSnapshot = { key: KEY, generation: 2, revision: 5, holder: holderA, holderId: "a", renewedAt: 1 };
    expect(Lease.restore(valid).ok).toBe(true);
    for (const broken of [
      { ...valid, key: "" },
      { ...valid, generation: 0 },
      { ...valid, generation: 1.5 },
      { ...valid, revision: 1 },
      { ...valid, holderId: null },
      { ...valid, holder: null },
      { ...valid, renewedAt: Number.NaN }
    ]) {
      expect(Lease.restore(broken)).toMatchObject({
        ok: false,
        error: { _tag: "LeaseRecordInvalid", key: broken.key }
      });
    }
  });
});

describe("lease rules", () => {
  const record = (revision: number, holder: HolderSnapshot | null = holderA): LeaseSnapshot => ({
    key: KEY,
    generation: 1,
    revision,
    holder,
    holderId: holder === null ? null : "a",
    renewedAt: 0
  });

  it("times expiry from the observer's first sight of a revision, with its own monotonic clock", () => {
    const first = restored(record(3)).observe(undefined, 100);
    expect(first).toEqual({ revision: 3, observedAt: 100 });
    expect(restored(record(3)).observe(first, 900)).toBe(first);
    expect(restored(record(3)).isFresh(first, 1099, 1000)).toBe(true);
    expect(restored(record(3)).isFresh(first, 1100, 1000)).toBe(false);
    // A newer revision than the observation has just changed.
    expect(restored(record(4)).isFresh(first, 5000, 1000)).toBe(true);
    expect(restored(record(4)).observe(first, 5000)).toEqual({ revision: 4, observedAt: 5000 });
    expect(restored(record(4, null)).isFresh({ revision: 4, observedAt: 5000 }, 5000, 1000)).toBe(false);
  });

  it("allows acquisition of a missing record, a tombstone, a dead holder or a silent one", () => {
    expect(Lease.canAcquire(undefined, alive)).toBe(true);
    expect(Lease.canAcquire(restored(record(2, null)), alive)).toBe(true);
    expect(Lease.canAcquire(restored(record(2)), { fresh: true, liveness: "dead" })).toBe(true);
    expect(Lease.canAcquire(restored(record(2)), { fresh: false, liveness: "alive" })).toBe(true);
    expect(Lease.canAcquire(restored(record(2)), alive)).toBe(false);
    expect(Lease.canAcquire(restored(record(2)), { fresh: true, liveness: "unknown" })).toBe(false);
  });

  it("S63: a reused pid is not the holder: liveness compares the start time and the boot", () => {
    const observer: HolderSnapshot = { ...host, pid: 99, startTime: 9 };
    expect(new Holder(holderA).liveness(new Holder(observer), new Holder(holderA))).toBe("alive");
    expect(new Holder(holderA).liveness(new Holder(observer), new Holder({ ...holderA, startTime: 1001 }))).toBe(
      "dead"
    );
    expect(new Holder(holderA).liveness(new Holder(observer), undefined)).toBe("dead");
    expect(new Holder({ ...holderA, bootId: "boot-0" }).liveness(new Holder(observer), new Holder(holderA))).toBe(
      "dead"
    );
    expect(new Holder({ ...holderA, host: "other" }).liveness(new Holder(observer), undefined)).toBe("unknown");
  });

  it("S62: hands out the next generation and lets a resource refuse an older token", () => {
    expect(FencingToken.next(KEY).toSnapshot()).toEqual({ key: KEY, generation: 1 });
    expect(FencingToken.next(KEY, new FencingToken(record(7))).toSnapshot()).toEqual({ key: KEY, generation: 2 });
    const lastSeen = new FencingToken({ key: KEY, generation: 3 });
    expect(new FencingToken({ key: KEY, generation: 1 }).checkFence(undefined)).toEqual({
      ok: true,
      value: { key: KEY, generation: 1 }
    });
    expect(new FencingToken({ key: KEY, generation: 3 }).checkFence(lastSeen).ok).toBe(true);
    expect(new FencingToken({ key: KEY, generation: 4 }).checkFence(lastSeen)).toEqual({
      ok: true,
      value: { key: KEY, generation: 4 }
    });
    expect(new FencingToken({ key: KEY, generation: 1 }).checkFence(lastSeen)).toEqual({
      ok: false,
      error: { _tag: "FenceRejected", key: KEY, generation: 1, current: 3 }
    });
  });

  it("accepts a timing where every duration is positive and two heartbeats fit in the TTL", () => {
    expect(LeaseTiming.create({ ttlMs: 100, heartbeatMs: 50 })).toEqual({
      ok: true,
      value: { ttlMs: 100, heartbeatMs: 50, retryMs: 50 }
    });
    expect(LeaseTiming.create({ ttlMs: 100, heartbeatMs: 50, retryMs: 25 })).toEqual({
      ok: true,
      value: { ttlMs: 100, heartbeatMs: 50, retryMs: 25 }
    });
    // A JS caller may pass null where the type says optional; it falls back like an absent retryMs.
    const nullRetry = { ttlMs: 100, heartbeatMs: 50, retryMs: null } as unknown as LeaseTimingInput;
    expect(LeaseTiming.create(nullRetry)).toEqual({ ok: true, value: { ttlMs: 100, heartbeatMs: 50, retryMs: 50 } });
    for (const input of [
      { ttlMs: 100, heartbeatMs: 60 },
      { ttlMs: 0, heartbeatMs: 0 },
      { ttlMs: 100, heartbeatMs: 50, retryMs: -1 },
      { ttlMs: Number.NaN, heartbeatMs: 10 }
    ]) {
      expect(LeaseTiming.create(input)).toMatchObject({ ok: false, error: { _tag: "LeaseConfigInvalid" } });
    }
  });

  it("names why a lease was lost from the record the loser sees", () => {
    expect(Lease.lossReason(undefined)).toBe("missing");
    expect(Lease.lossReason(record(2, null))).toBe("released");
    expect(Lease.lossReason(record(2))).toBe("taken-over");
    // A tombstone is a record with no holder, so the holder field decides whatever holderId says.
    expect(Lease.lossReason({ ...record(2), holder: null })).toBe("released");
  });

  it("expires a holder that has confirmed no renewal for a whole TTL, measured on its own clock", () => {
    expect(timing(1000).holderExpired(100, 1099)).toBe(false);
    expect(timing(1000).holderExpired(100, 1100)).toBe(true);
  });
});

describe("lease value ownership", () => {
  it("copies holder and token data before freezing, and returns plain boundary data", () => {
    const identity = { ...holderA };
    const holder = new Holder(identity);
    const tokenData = { key: KEY, generation: 2 };
    const token = new FencingToken(tokenData);
    expect(Object.isFrozen(identity)).toBe(false);
    expect(Object.isFrozen(tokenData)).toBe(false);
    expect(Object.isFrozen(holder)).toBe(true);
    expect(Object.isFrozen(token)).toBe(true);
    identity.pid = 99;
    tokenData.generation = 9;
    expect(holder.pid).toBe(10);
    expect(token.generation).toBe(2);
    expect(Object.getPrototypeOf(holder.toSnapshot())).toBe(Object.prototype);
    expect(Object.getPrototypeOf(token.toSnapshot())).toBe(Object.prototype);
    expect(holder.toSnapshot()).toEqual(holderA);
    expect(token.toSnapshot()).toEqual({ key: KEY, generation: 2 });
  });

  it("keeps accepted and rejected lease snapshots owned by the caller", () => {
    const snapshot = {
      key: KEY,
      generation: 2,
      revision: 5,
      holder: { ...holderA },
      holderId: "a",
      renewedAt: 1
    };
    const lease = restored(snapshot);
    expect(Object.isFrozen(snapshot)).toBe(false);
    expect(Object.isFrozen(snapshot.holder)).toBe(false);
    expect(Object.isFrozen(lease.toSnapshot())).toBe(true);
    expect(Object.isFrozen(lease.toSnapshot().holder)).toBe(true);
    snapshot.holder.pid = 90;
    snapshot.revision = 9;
    expect(lease.toSnapshot()).toMatchObject({ revision: 5, holder: { pid: 10 } });
    const broken = { ...snapshot, generation: 0 };
    const before = structuredClone(broken);
    expect(Lease.restore(broken).ok).toBe(false);
    expect(broken).toEqual(before);
    expect(Object.isFrozen(broken)).toBe(false);
    expect(Object.isFrozen(broken.holder)).toBe(false);
  });

  it("keeps the existing record validation order and reasons", () => {
    const valid = Lease.create(claim(holderA, "a")).state.toSnapshot();
    for (const [fields, message] of [
      [{ key: "", generation: 0 }, "the key is empty"],
      [{ generation: 0, revision: -1 }, "generation 0 is not a positive integer"],
      [{ revision: 0, holderId: null }, "revision 0 is not an integer at least as large as the generation"],
      [{ holderId: null, renewedAt: Number.NaN }, "a holder and a holder id come together"],
      [{ renewedAt: Number.NaN }, "renewedAt is not a number"]
    ] as const) {
      const snapshot = { ...valid, ...fields };
      expect(Lease.restore(snapshot)).toEqual({
        ok: false,
        error: { _tag: "LeaseRecordInvalid", key: snapshot.key, message }
      });
    }
  });

  it("refuses invalid value construction without freezing rejected inputs", () => {
    for (const data of [
      { key: "", generation: 1 },
      { key: KEY, generation: 0 },
      { key: KEY, generation: 1.5 }
    ]) {
      expect(() => new FencingToken(data)).toThrow(/the key is empty|is not a positive integer/);
      expect(Object.isFrozen(data)).toBe(false);
    }
    for (const fields of [{ pid: Number.NaN }, { startTime: Number.POSITIVE_INFINITY }]) {
      const data = { ...holderA, ...fields };
      expect(() => new Holder(data)).toThrow("holder pid and startTime must be finite numbers");
      expect(Object.isFrozen(data)).toBe(false);
    }
    const invalid = {
      ...Lease.create(claim(holderA, "a")).state.toSnapshot(),
      holder: { ...holderA, pid: Number.NaN }
    };
    expect(Lease.restore(invalid)).toMatchObject({ ok: false, error: { _tag: "LeaseRecordInvalid" } });
  });

  it("compares fencing generations only for the same key", () => {
    const token = new FencingToken({ key: "other", generation: 1 });
    expect(token.checkFence(new FencingToken({ key: KEY, generation: 5 }))).toEqual({ ok: true, value: token });
  });

  it("freezes timing without retaining or freezing the caller's configuration", () => {
    const input = { ttlMs: 1000, heartbeatMs: 100 };
    const value = LeaseTiming.create(input);
    expect(value.ok).toBe(true);
    expect(Object.isFrozen(input)).toBe(false);
    input.ttlMs = 1;
    expect(value.ok && value.value.ttlMs).toBe(1000);
    expect(value.ok && Object.isFrozen(value.value)).toBe(true);
    expect(LeaseTiming.create({ ttlMs: 0, heartbeatMs: 0, retryMs: 0 })).toEqual({
      ok: false,
      error: { _tag: "LeaseConfigInvalid", message: "ttlMs must be a positive number of milliseconds, got 0" }
    });
  });
});
