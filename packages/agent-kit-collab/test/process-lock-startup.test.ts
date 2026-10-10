import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { acquireProcessLock } from "../src/process-lock/public.js";
import { removeTempDirs, tempDir, testPlatform } from "./support/platform.js";

// Counts the identity probe itself (a child process on darwin, a /proc read on linux). `.self` does not go through
// `platform.process.identify`, so counting that method would miss the first stamp.
const probes = vi.hoisted(() => ({ count: 0 }));

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return {
    ...original,
    execFileSync(file: string, args?: readonly string[], options?: import("node:child_process").ExecFileSyncOptions) {
      probes.count += 1;
      if (args === undefined) {
        return original.execFileSync(file);
      }
      if (options === undefined) {
        return original.execFileSync(file, args);
      }
      return original.execFileSync(file, args, options);
    }
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return {
    ...original,
    readFileSync(path: import("node:fs").PathOrFileDescriptor, options?: BufferEncoding) {
      if (typeof path === "string" && path.startsWith("/proc/")) {
        probes.count += 1;
      }
      if (options === undefined) {
        return original.readFileSync(path);
      }
      return original.readFileSync(path, options);
    }
  };
});

afterEach(() => {
  probes.count = 0;
  removeTempDirs();
});

describe("a second acquire in one process", () => {
  it("spawns no identity probe and reports ProcessLockHeld for the holder that was recorded", async () => {
    for (const mechanism of ["sqlite", "file"] as const) {
      const path = join(tempDir(), "daemon.lock");
      const firstPlatform = testPlatform({ sqlite: mechanism === "sqlite" });
      const before = probes.count;
      const first = await acquireProcessLock(firstPlatform, path);
      if (!first.ok) {
        throw new Error("the first acquire did not take the lock");
      }
      if (mechanism === "sqlite") {
        // The kernel frees a SQLite lock when the holder exits, so the stamp is diagnostic and omits the fields
        // that a probe would read.
        expect(probes.count).toBe(before);
        expect(JSON.parse(readFileSync(`${path}.holder`, "utf8"))).toEqual({
          host: first.value.holder.host,
          pid: process.pid,
          acquiredAt: first.value.holder.acquiredAt,
          nonce: expect.any(String)
        });
      } else {
        expect(probes.count).toBeGreaterThan(before);
        expect(first.value.holder.bootId).toEqual(expect.any(String));
        expect(first.value.holder.startTime).toEqual(expect.any(Number));
      }

      const secondPlatform = testPlatform({ sqlite: mechanism === "sqlite" });
      const atSecond = probes.count;
      const second = await acquireProcessLock(secondPlatform, path);
      expect(probes.count).toBe(atSecond);
      if (second.ok) {
        throw new Error("the second acquire took the lock");
      }
      expect(second.error).toEqual({ _tag: "ProcessLockHeld", path, holder: first.value.holder });

      if (mechanism === "sqlite") {
        const recorded = {
          host: first.value.holder.host,
          pid: first.value.holder.pid,
          bootId: "6f1c2a9e-0000-4000-8000-000000000001",
          startTime: 5,
          acquiredAt: 6,
          nonce: "previous"
        };
        writeFileSync(`${path}.holder`, JSON.stringify(recorded));
        const atPrevious = probes.count;
        const previous = await acquireProcessLock(testPlatform(), path);
        expect(probes.count).toBe(atPrevious);
        if (previous.ok) {
          throw new Error("the lock with an older stamp was taken");
        }
        const { nonce, ...holder } = recorded;
        expect(previous.error).toEqual({ _tag: "ProcessLockHeld", path, holder });
        expect(nonce).toBe("previous");
      }
      await first.value.release();
    }
  });
});
