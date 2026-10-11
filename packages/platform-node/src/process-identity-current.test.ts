import { hostname } from "node:os";

import { describe, expect, it, vi } from "vite-plus/test";

import { createIdentify } from "./process-identity.js";

// Own file so the module-level probe cache starts empty. The other identity tests share one boot id and do not count
// reads, so they stay valid once a boot id is reused across closures.
const { readFile, execFile } = vi.hoisted(() => ({
  readFile: vi.fn<(path: string) => string>(),
  execFile: vi.fn<(file: string, args: readonly string[]) => string>()
}));
vi.mock("node:fs", async (importOriginal) => ({ ...(await importOriginal<object>()), readFileSync: readFile }));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  execFileSync: execFile
}));

const BOOT_ID = "6f1c2a9e-0000-4000-8000-000000000001";
// A fixed pid collides when this worker's pid is that value: both reads hit the self cache.
const otherPid = process.pid + 1;

function procStat(pid: number, startTicks: number): string {
  const middle = "1 1 1 0 -1 4194560 100 0 0 0 1 2 0 0 20 0 1 0";
  return `${pid} (node) S ${middle} ${startTicks} 12345678 300 18446744073709551615\n`;
}

describe("current process identity", () => {
  it("reads boot id and this process once per operating system, and another pid on every call", () => {
    readFile.mockImplementation((path) => {
      if (path === "/proc/sys/kernel/random/boot_id") {
        return `${BOOT_ID}\n`;
      }
      if (path === `/proc/${process.pid}/stat`) {
        return procStat(process.pid, 111);
      }
      if (path === `/proc/${otherPid}/stat`) {
        return procStat(otherPid, 222);
      }
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    });
    const linuxA = createIdentify("linux");
    const linuxB = createIdentify("linux");
    const linuxSelf = linuxA(process.pid);
    expect(linuxSelf).toEqual({ host: hostname(), bootId: BOOT_ID, pid: process.pid, startTime: 111 });
    expect(linuxB(process.pid)).toEqual(linuxSelf);
    expect(readFile).toHaveBeenCalledTimes(2);
    expect(linuxA(otherPid)?.startTime).toBe(222);
    expect(linuxB(otherPid)?.startTime).toBe(222);
    expect(readFile).toHaveBeenCalledTimes(4);

    execFile.mockImplementation((file, args) => {
      if (file === "/usr/sbin/sysctl") {
        return `${BOOT_ID}\n`;
      }
      const pid = Number(args.at(-1));
      const start = pid === process.pid ? "06:22:02" : "06:22:03";
      return `Ss   Wed Oct  7 ${start} 2026\n`;
    });
    const darwinA = createIdentify("darwin");
    const darwinB = createIdentify("darwin");
    const darwinSelf = darwinA(process.pid);
    expect(darwinSelf).toEqual({
      host: hostname(),
      bootId: BOOT_ID,
      pid: process.pid,
      startTime: Date.UTC(2026, 9, 7, 6, 22, 2)
    });
    expect(darwinB(process.pid)).toEqual(darwinSelf);
    expect(execFile).toHaveBeenCalledTimes(2);
    expect(darwinA(otherPid)?.startTime).toBe(Date.UTC(2026, 9, 7, 6, 22, 3));
    expect(darwinB(otherPid)?.startTime).toBe(Date.UTC(2026, 9, 7, 6, 22, 3));
    expect(execFile).toHaveBeenCalledTimes(4);
  });
});
