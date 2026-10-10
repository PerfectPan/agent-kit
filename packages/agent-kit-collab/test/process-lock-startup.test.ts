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
  it("spawns no identity probe and reports ProcessLockHeld for the same holder", async () => {
    for (const mechanism of ["sqlite", "file"] as const) {
      const path = join(tempDir(), "daemon.lock");
      const firstPlatform = testPlatform({ sqlite: mechanism === "sqlite" });
      const before = probes.count;
      const first = await acquireProcessLock(firstPlatform, path);
      if (!first.ok) {
        throw new Error("the first acquire did not take the lock");
      }
      // The process is probed on the first stamp. A later mechanism reuses that read.
      if (mechanism === "sqlite") {
        expect(probes.count).toBeGreaterThan(before);
      }

      const secondPlatform = testPlatform({ sqlite: mechanism === "sqlite" });
      const atSecond = probes.count;
      const second = await acquireProcessLock(secondPlatform, path);
      expect(probes.count).toBe(atSecond);
      if (second.ok) {
        throw new Error("the second acquire took the lock");
      }
      expect(second.error).toEqual({ _tag: "ProcessLockHeld", path, holder: first.value.holder });
      await first.value.release();
    }
  });
});
