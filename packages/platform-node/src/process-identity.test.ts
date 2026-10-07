import { hostname } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createIdentify } from "./process-identity.js";

// Both probes run against synthetic OS output here, so each is covered on every OS; process.test.ts covers the real
// probe of the OS the tests run on.
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

function procStat(pid: number, comm: string, state: string, startTicks: number): string {
  const middle = "1 1 1 0 -1 4194560 100 0 0 0 1 2 0 0 20 0 1 0";
  return `${pid} (${comm}) ${state} ${middle} ${startTicks} 12345678 300 18446744073709551615\n`;
}

const failure = (fields: object): Error => Object.assign(new Error("failed"), fields);

/** Paths missing from `files` fail with ENOENT; an `Error` value is thrown as the read error. */
function fakeFiles(files: Record<string, string | Error>): void {
  readFile.mockImplementation((path) => {
    const content = files[path] ?? failure({ code: "ENOENT" });
    if (content instanceof Error) {
      throw content;
    }
    return content;
  });
}

/** An `Error` value is thrown as the execFileSync failure. */
function fakePs(outputs: Record<string, string | Error>): void {
  execFile.mockImplementation((file, args) => {
    const output = outputs[file === "/bin/ps" ? `ps ${args.at(-1)}` : `${file} ${args.join(" ")}`];
    if (output === undefined || output instanceof Error) {
      throw output ?? failure({ code: "ENOENT" });
    }
    return output;
  });
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("linux identity", () => {
  it("reads start ticks after a command name that contains spaces and parentheses", () => {
    fakeFiles({
      "/proc/sys/kernel/random/boot_id": `${BOOT_ID}\n`,
      "/proc/42/stat": procStat(42, "a) b (c", "S", 98_765)
    });
    expect(createIdentify("linux")(42)).toEqual({ host: hostname(), bootId: BOOT_ID, pid: 42, startTime: 98_765 });
  });

  it("returns undefined for a missing, exiting or zombie process", () => {
    fakeFiles({
      "/proc/sys/kernel/random/boot_id": BOOT_ID,
      "/proc/7/stat": procStat(7, "sh", "Z", 5),
      "/proc/9/stat": failure({ code: "ESRCH" })
    });
    const identify = createIdentify("linux");
    expect(identify(7)).toBeUndefined();
    expect(identify(8)).toBeUndefined();
    expect(identify(9)).toBeUndefined();
  });

  it("throws when the stat file exists but cannot be read, instead of reporting a live process as gone", () => {
    fakeFiles({
      "/proc/sys/kernel/random/boot_id": BOOT_ID,
      "/proc/10/stat": failure({ code: "EACCES" }),
      "/proc/11/stat": failure({ code: "EMFILE" })
    });
    const identify = createIdentify("linux");
    expect(() => identify(10)).toThrow(expect.objectContaining({ code: "EACCES" }));
    expect(() => identify(11)).toThrow(expect.objectContaining({ code: "EMFILE" }));
  });
});

describe("win32 identity", () => {
  it("throws instead of returning a partial identity", () => {
    expect(() => createIdentify("win32")(1)).toThrow("not supported on win32");
  });
});

describe("darwin identity", () => {
  it("reads lstart as UTC epoch milliseconds and the boot session UUID", () => {
    fakePs({
      "ps 42": "Ss   Wed Oct  7 06:22:02 2026    \n",
      "/usr/sbin/sysctl -n kern.bootsessionuuid": `${BOOT_ID}\n`
    });
    expect(createIdentify("darwin")(42)).toEqual({
      host: hostname(),
      bootId: BOOT_ID,
      pid: 42,
      startTime: Date.UTC(2026, 9, 7, 6, 22, 2)
    });
  });

  it("returns undefined when ps finds no process or a zombie, and throws on unexpected output", () => {
    fakePs({
      "ps 7": "ZN   Wed Oct  7 06:22:02 2026\n",
      "ps 8": failure({ status: 1, stdout: "", stderr: "" }),
      "ps 9": "garbage\n"
    });
    const identify = createIdentify("darwin");
    expect(identify(7)).toBeUndefined();
    expect(identify(8)).toBeUndefined();
    expect(() => identify(9)).toThrow("Unexpected ps output");
  });

  it("throws when ps fails for another reason, instead of reporting a live process as gone", () => {
    fakePs({
      "ps 10": failure({ status: 1, stdout: "", stderr: "ps: some error\n" }),
      "ps 11": failure({ code: "EAGAIN", status: null, stdout: "", stderr: "" }),
      "ps 12": failure({ status: null, signal: "SIGKILL", stdout: "", stderr: "" })
    });
    const identify = createIdentify("darwin");
    expect(() => identify(10)).toThrow(expect.objectContaining({ stderr: "ps: some error\n" }));
    expect(() => identify(11)).toThrow(expect.objectContaining({ code: "EAGAIN" }));
    expect(() => identify(12)).toThrow(expect.objectContaining({ signal: "SIGKILL" }));
  });
});
