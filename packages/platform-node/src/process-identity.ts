import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";

import type { OperatingSystem, ProcessIdentity } from "@rivus/agent-kit-platform";

import { hasCode } from "./error-code.js";

interface IdentityProbe {
  bootId(): string;
  /** `undefined` when the process does not exist or has already exited (a zombie). */
  startTime(pid: number): number | undefined;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const linux: IdentityProbe = {
  bootId: () => readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(),
  startTime(pid) {
    let stat: string;
    try {
      stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    } catch (error) {
      // ESRCH: the process exited while its stat file was being read. Anything else says nothing about liveness.
      if (hasCode(error, "ENOENT", "ESRCH")) {
        return undefined;
      }
      throw error;
    }
    // Field 2, the command name, is parenthesized and may contain spaces and parentheses itself. Index 0 of the rest
    // is field 3 (state), so field 22 (start time in clock ticks after boot) is index 19.
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const state = fields[0];
    const startTicks = fields[19] ?? "";
    if (state === "Z" || state === "X") {
      return undefined;
    }
    if (!/^\d+$/.test(startTicks)) {
      throw new Error(`Unexpected /proc/${pid}/stat format: ${stat}`);
    }
    return Number(startTicks);
  }
};

const darwin: IdentityProbe = {
  // Unlike kern.boottime, which moves when the wall clock is stepped, the boot session UUID is fixed for a boot.
  bootId: () => execFileSync("/usr/sbin/sysctl", ["-n", "kern.bootsessionuuid"], { encoding: "utf8" }).trim(),
  startTime(pid) {
    let output: string;
    try {
      // A fixed locale and time zone make `lstart` identical whichever process reads it.
      output = execFileSync("/bin/ps", ["-o", "stat=,lstart=", "-p", String(pid)], {
        encoding: "utf8",
        env: { LC_ALL: "C", TZ: "UTC0" },
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      if (isNoMatchingProcess(error)) {
        return undefined;
      }
      throw error;
    }
    const match = /^(\S+)\s+\S+\s+(\S+)\s+(\d+)\s+(\d+):(\d+):(\d+)\s+(\d+)$/.exec(output.trim());
    const month = MONTHS.indexOf(match?.[2] ?? "");
    if (match === null || month === -1) {
      throw new Error(`Unexpected ps output for pid ${pid}: ${output}`);
    }
    if (match[1]?.startsWith("Z") === true) {
      return undefined;
    }
    const [day, hours, minutes, seconds, year] = match.slice(3).map(Number) as [number, number, number, number, number];
    return Date.UTC(year, month, day, hours, minutes, seconds);
  }
};

/** ps exits with 1 and prints nothing when no process matches; it also exits with 1 on other errors, with a message. */
function isNoMatchingProcess(error: unknown): boolean {
  return (
    error instanceof Error &&
    "status" in error &&
    error.status === 1 &&
    "stdout" in error &&
    error.stdout === "" &&
    "stderr" in error &&
    error.stderr === ""
  );
}

/**
 * Returns `identify(pid)`. Start times are Linux clock ticks after boot or macOS start seconds as epoch milliseconds;
 * either way the same probe serves every pid, so equal identities mean the same process.
 */
export function createIdentify(os: OperatingSystem): (pid: number) => ProcessIdentity | undefined {
  if (os === "win32") {
    return () => {
      throw new Error("Process identity (boot id and start time) is not supported on win32");
    };
  }
  const probe = os === "linux" ? linux : darwin;
  let machine: { readonly host: string; readonly bootId: string } | undefined;
  return (pid) => {
    if (!Number.isSafeInteger(pid) || pid <= 0) {
      return undefined;
    }
    const startTime = probe.startTime(pid);
    if (startTime === undefined) {
      return undefined;
    }
    machine ??= { host: hostname(), bootId: probe.bootId() };
    return { ...machine, pid, startTime };
  };
}
