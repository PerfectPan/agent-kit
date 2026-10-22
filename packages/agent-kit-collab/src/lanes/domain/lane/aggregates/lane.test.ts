import { describe, expect, it } from "vite-plus/test";

import { LaneLimits } from "../value-objects/lane-limits.js";
import { Lane, type LaneTransition } from "./lane.js";

const KEY = "room:1";
const free = { running: 0, queued: 0 };
const busy = { running: 2, queued: 0 };

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) {
    throw new Error(`unexpected ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

const limits = unwrap(LaneLimits.create({ maxConcurrent: 2, maxQueued: 1 }));

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
    expect(unwrap(LaneLimits.create({ maxConcurrent: 2, maxQueued: 2 })).admit({ running: 1, queued: 1 })).toBe(
      "queue"
    );
    expect(limits.admit({ running: 1, queued: 0 })).toBe("start");
    expect(limits.admit({ running: 2, queued: 1 })).toBe("full");
    expect(unwrap(LaneLimits.create({ maxConcurrent: 2 })).admit({ running: 2, queued: 1000 })).toBe("queue");
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
    expect(LaneLimits.create({ maxConcurrent: 1 })).toEqual({
      ok: true,
      value: { maxConcurrent: 1, maxQueued: Number.POSITIVE_INFINITY, turnTimeoutMs: undefined }
    });
    expect(LaneLimits.create({ maxConcurrent: 3, maxQueued: 0, turnTimeoutMs: 500 })).toEqual({
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
      expect(LaneLimits.create(input)).toMatchObject({ ok: false, error: { _tag: "LanesConfigInvalid" } });
    }
  });
});

describe("admission across lanes", () => {
  it("gives a free slot to the head of the queue while the lanes are open, and to nobody otherwise", () => {
    const limits = unwrap(LaneLimits.create({ maxConcurrent: 2, maxQueued: 5 }));
    const load = { running: 1, queued: 2 };
    expect(limits.nextToStart(["b", "a"], load, false)).toBe("b");
    expect(limits.nextToStart([], load, false)).toBeUndefined();
    expect(limits.nextToStart(["b", "a"], { running: 2, queued: 2 }, false)).toBeUndefined();
    expect(limits.nextToStart(["b", "a"], load, true)).toBeUndefined();
  });

  it("reads a wake from its events: started, queued, or served by an activation that has not begun", () => {
    expect(Lane.wakeResult([{ _tag: "ActivationStarted", key: KEY }])).toBe("started");
    expect(Lane.wakeResult([{ _tag: "LaneQueued", key: KEY }])).toBe("queued");
    expect(Lane.wakeResult([{ _tag: "WakeCoalesced", key: KEY }])).toBe("coalesced");
    // Starting wins over queueing: a queued lane that got its slot started.
    expect(
      Lane.wakeResult([
        { _tag: "LaneQueued", key: KEY },
        { _tag: "ActivationStarted", key: KEY }
      ])
    ).toBe("started");
  });
});

describe("lane value ownership", () => {
  it("freezes limits without retaining or freezing the caller's configuration", () => {
    const input = { maxConcurrent: 2, maxQueued: 1 };
    const value = unwrap(LaneLimits.create(input));
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(value)).toBe(true);
    input.maxConcurrent = 10;
    expect(value.maxConcurrent).toBe(2);
    const broken = { maxConcurrent: 0, maxQueued: -1 };
    expect(LaneLimits.create(broken)).toEqual({
      ok: false,
      error: {
        _tag: "LanesConfigInvalid",
        message: "maxConcurrent must be a positive integer, got 0"
      }
    });
    expect(Object.isFrozen(broken)).toBe(false);
  });

  it("keeps immutable lane snapshots across transitions", () => {
    const idle = Lane.create(KEY);
    const started = unwrap(idle.wake(free, limits)).state;
    expect(Object.isFrozen(idle.toSnapshot())).toBe(true);
    expect(Object.isFrozen(started.toSnapshot())).toBe(true);
    expect(idle.toSnapshot()).toEqual({ key: KEY, state: "idle", pending: false });
    expect(started.toSnapshot()).toEqual({ key: KEY, state: "running", pending: false });
  });
});
