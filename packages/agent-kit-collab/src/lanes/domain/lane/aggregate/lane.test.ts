import { describe, expect, it } from "vitest";

import { admit } from "../policies/admission.js";
import { type LaneLimits, laneLimits } from "../value-objects/lane-limits.js";
import { Lane, type LaneTransition } from "./lane.js";

const KEY = "room:1";
const limits: LaneLimits = { maxConcurrent: 2, maxQueued: 1, turnTimeoutMs: undefined };
const free = { running: 0, queued: 0 };
const busy = { running: 2, queued: 0 };

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) {
    throw new Error(`unexpected ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

const tags = ({ events }: LaneTransition) => events.map(({ _tag }) => _tag);

describe("Lane", () => {
  it("starts an idle lane while a slot is free and nobody waits, queues it otherwise, and refuses it when full", () => {
    const idle = Lane.create(KEY);
    const started = unwrap(idle.wake(free, limits));
    expect(started.state.toSnapshot()).toEqual({ key: KEY, state: "running", pending: false });
    expect(tags(started)).toEqual(["ActivationStarted"]);

    const queued = unwrap(idle.wake(busy, limits));
    expect(queued.state.toSnapshot()).toEqual({ key: KEY, state: "queued", pending: true });
    expect(tags(queued)).toEqual(["LaneQueued"]);

    expect(idle.wake({ running: 2, queued: 1 }, limits)).toEqual({
      ok: false,
      error: { _tag: "LaneQueueFull", key: KEY, maxQueued: 1 }
    });
  });

  it("does not let a newcomer pass a lane that already waits, even when a slot is free", () => {
    expect(admit({ running: 1, queued: 1 }, { ...limits, maxQueued: 2 })).toBe("queue");
    expect(admit({ running: 1, queued: 0 }, limits)).toBe("start");
    expect(admit({ running: 2, queued: 1 }, limits)).toBe("full");
    expect(admit({ running: 2, queued: 1000 }, { ...limits, maxQueued: Number.POSITIVE_INFINITY })).toBe("queue");
  });

  it("coalesces wakes of a queued or running lane into one pending activation, whatever the queue holds", () => {
    const queued = unwrap(Lane.create(KEY).wake(busy, limits)).state;
    const again = unwrap(queued.wake({ running: 2, queued: 1 }, limits));
    expect(again.state.toSnapshot()).toEqual({ key: KEY, state: "queued", pending: true });
    expect(tags(again)).toEqual(["WakeCoalesced"]);

    const running = unwrap(Lane.create(KEY).wake(free, limits)).state;
    const woken = unwrap(running.wake({ running: 2, queued: 1 }, limits));
    expect(woken.state.toSnapshot()).toEqual({ key: KEY, state: "running", pending: true });
    const twice = unwrap(woken.state.wake({ running: 2, queued: 1 }, limits));
    expect(twice.state.toSnapshot()).toEqual(woken.state.toSnapshot());
    expect(tags(twice)).toEqual(["WakeCoalesced"]);
  });

  it("starts a queued lane, and after its activation goes idle or back to the end of the queue", () => {
    const queued = unwrap(Lane.create(KEY).wake(busy, limits)).state;
    const started = queued.start();
    expect(started.state.toSnapshot()).toEqual({ key: KEY, state: "running", pending: false });
    expect(tags(started)).toEqual(["LaneDequeued", "ActivationStarted"]);

    const idle = started.state.finish();
    expect(idle.state.toSnapshot()).toEqual({ key: KEY, state: "idle", pending: false });
    expect(tags(idle)).toEqual(["ActivationEnded"]);

    const woken = unwrap(started.state.wake(busy, limits)).state;
    const requeued = woken.finish();
    expect(requeued.state.toSnapshot()).toEqual({ key: KEY, state: "queued", pending: true });
    expect(tags(requeued)).toEqual(["ActivationEnded", "LaneQueued"]);
  });

  it("drops what a cancel finds owed: the queue place, or the activation after the running one", () => {
    const queued = unwrap(Lane.create(KEY).wake(busy, limits)).state.cancel();
    expect(queued.state.toSnapshot()).toEqual({ key: KEY, state: "idle", pending: false });
    expect(tags(queued)).toEqual(["LaneDequeued"]);

    const running = unwrap(Lane.create(KEY).wake(free, limits)).state;
    const pending = unwrap(running.wake(busy, limits)).state.cancel();
    expect(pending.state.toSnapshot()).toEqual({ key: KEY, state: "running", pending: false });
    expect(tags(pending)).toEqual(["PendingDropped"]);
    expect(tags(running.cancel())).toEqual([]);
    expect(tags(Lane.create(KEY).cancel())).toEqual([]);
  });

  it("treats starting a lane that is not queued, or finishing one that is not running, as a defect", () => {
    const running = unwrap(Lane.create(KEY).wake(free, limits)).state;
    expect(() => running.start()).toThrow(/running, not queued/);
    expect(() => Lane.create(KEY).finish()).toThrow(/idle, not running/);
  });
});

describe("laneLimits", () => {
  it("S105: accepts a positive capacity, a non-negative queue bound and a positive turn timeout", () => {
    expect(laneLimits({ maxConcurrent: 1 })).toEqual({
      ok: true,
      value: { maxConcurrent: 1, maxQueued: Number.POSITIVE_INFINITY, turnTimeoutMs: undefined }
    });
    expect(laneLimits({ maxConcurrent: 3, maxQueued: 0, turnTimeoutMs: 500 })).toEqual({
      ok: true,
      value: { maxConcurrent: 3, maxQueued: 0, turnTimeoutMs: 500 }
    });
    for (const input of [
      { maxConcurrent: 0 },
      { maxConcurrent: 1.5 },
      { maxConcurrent: Number.POSITIVE_INFINITY },
      { maxConcurrent: 1, maxQueued: -1 },
      { maxConcurrent: 1, maxQueued: 0.5 },
      { maxConcurrent: 1, turnTimeoutMs: 0 },
      { maxConcurrent: 1, turnTimeoutMs: Number.NaN }
    ]) {
      expect(laneLimits(input)).toMatchObject({ ok: false, error: { _tag: "LanesConfigInvalid" } });
    }
  });
});
