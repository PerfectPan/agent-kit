import { describe, expect, it } from "vitest";

import { canAcquire } from "../policies/acquisition.js";
import { checkFence, nextFencingToken } from "../policies/fence-check.js";
import { holderExpired, isFresh, observe } from "../policies/freshness.js";
import { holderLiveness } from "../policies/holder-liveness.js";
import { lossReason } from "../policies/loss.js";
import { leaseTiming } from "../value-objects/lease-timing.js";
import type { Holder } from "../value-objects/holder.js";
import type { LeaseSnapshot } from "../value-objects/lease-snapshot.js";
import { Lease, type LeaseClaim } from "./lease.js";

const KEY = "task:1";
const host = { host: "box", bootId: "boot-1" };
const holderA: Holder = { ...host, pid: 10, startTime: 1000 };
const holderB: Holder = { ...host, pid: 20, startTime: 2000 };
const claim = (holder: Holder, holderId: string, now = 0): LeaseClaim => ({ key: KEY, holder, holderId, now });
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
  const record = (revision: number, holder: Holder | null = holderA): LeaseSnapshot => ({
    key: KEY,
    generation: 1,
    revision,
    holder,
    holderId: holder === null ? null : "a",
    renewedAt: 0
  });

  it("times expiry from the observer's first sight of a revision, with its own monotonic clock", () => {
    const first = observe(undefined, record(3), 100);
    expect(first).toEqual({ revision: 3, observedAt: 100 });
    expect(observe(first, record(3), 900)).toBe(first);
    expect(isFresh(record(3), first, 1099, 1000)).toBe(true);
    expect(isFresh(record(3), first, 1100, 1000)).toBe(false);
    // A newer revision than the observation has just changed.
    expect(isFresh(record(4), first, 5000, 1000)).toBe(true);
    expect(observe(first, record(4), 5000)).toEqual({ revision: 4, observedAt: 5000 });
    expect(isFresh(record(4, null), { revision: 4, observedAt: 5000 }, 5000, 1000)).toBe(false);
  });

  it("allows acquisition of a missing record, a tombstone, a dead holder or a silent one", () => {
    expect(canAcquire(undefined, alive)).toBe(true);
    expect(canAcquire(record(2, null), alive)).toBe(true);
    expect(canAcquire(record(2), { fresh: true, liveness: "dead" })).toBe(true);
    expect(canAcquire(record(2), { fresh: false, liveness: "alive" })).toBe(true);
    expect(canAcquire(record(2), alive)).toBe(false);
    expect(canAcquire(record(2), { fresh: true, liveness: "unknown" })).toBe(false);
  });

  it("S63: a reused pid is not the holder: liveness compares the start time and the boot", () => {
    const observer: Holder = { ...host, pid: 99, startTime: 9 };
    expect(holderLiveness(holderA, observer, holderA)).toBe("alive");
    expect(holderLiveness(holderA, observer, { ...holderA, startTime: 1001 })).toBe("dead");
    expect(holderLiveness(holderA, observer, undefined)).toBe("dead");
    expect(holderLiveness({ ...holderA, bootId: "boot-0" }, observer, holderA)).toBe("dead");
    expect(holderLiveness({ ...holderA, host: "other" }, observer, undefined)).toBe("unknown");
  });

  it("S62: hands out the next generation and lets a resource refuse an older token", () => {
    expect(nextFencingToken(undefined, KEY)).toEqual({ key: KEY, generation: 1 });
    expect(nextFencingToken(record(7), KEY)).toEqual({ key: KEY, generation: 2 });
    const lastSeen = { key: KEY, generation: 3 };
    expect(checkFence(undefined, { key: KEY, generation: 1 })).toEqual({
      ok: true,
      value: { key: KEY, generation: 1 }
    });
    expect(checkFence(lastSeen, { key: KEY, generation: 3 }).ok).toBe(true);
    expect(checkFence(lastSeen, { key: KEY, generation: 4 })).toEqual({ ok: true, value: { key: KEY, generation: 4 } });
    expect(checkFence(lastSeen, { key: KEY, generation: 1 })).toEqual({
      ok: false,
      error: { _tag: "FenceRejected", key: KEY, generation: 1, current: 3 }
    });
  });

  it("accepts a timing where every duration is positive and two heartbeats fit in the TTL", () => {
    expect(leaseTiming({ ttlMs: 100, heartbeatMs: 50 })).toEqual({
      ok: true,
      value: { ttlMs: 100, heartbeatMs: 50, retryMs: 50 }
    });
    expect(leaseTiming({ ttlMs: 100, heartbeatMs: 50, retryMs: 25 })).toEqual({
      ok: true,
      value: { ttlMs: 100, heartbeatMs: 50, retryMs: 25 }
    });
    // The boundary: two heartbeats may be exactly the TTL, so one late heartbeat cannot lose it.
    expect(leaseTiming({ ttlMs: 100, heartbeatMs: 50 }).ok).toBe(true);
    for (const input of [
      { ttlMs: 100, heartbeatMs: 60 },
      { ttlMs: 0, heartbeatMs: 0 },
      { ttlMs: 100, heartbeatMs: 50, retryMs: -1 },
      { ttlMs: Number.NaN, heartbeatMs: 10 }
    ]) {
      expect(leaseTiming(input)).toMatchObject({ ok: false, error: { _tag: "LeaseConfigInvalid" } });
    }
  });

  it("names why a lease was lost from the record the loser sees", () => {
    expect(lossReason(undefined)).toBe("missing");
    expect(lossReason(record(2, null))).toBe("released");
    expect(lossReason(record(2))).toBe("taken-over");
  });

  it("expires a holder that has confirmed no renewal for a whole TTL, measured on its own clock", () => {
    expect(holderExpired(100, 1099, 1000)).toBe(false);
    expect(holderExpired(100, 1100, 1000)).toBe(true);
  });
});
