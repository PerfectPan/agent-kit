import type { FileStat, Platform } from "@rivus/agent-kit-platform";
import { describe, expect, it } from "vite-plus/test";

import { findOnPath } from "./path-lookup.js";

/** A platform whose file system holds exactly `files`. */
function platform(os: Platform["os"], path: string, files: readonly string[]): Pick<Platform, "env" | "os" | "fs"> {
  const stat = async (target: string): Promise<FileStat | undefined> =>
    files.includes(target) ? { kind: "file", size: 0, mtimeMs: 0 } : undefined;
  return { os, env: { PATH: path }, fs: { stat } as unknown as Platform["fs"] };
}

describe("findOnPath", () => {
  it("finds a command in the absolute directories of PATH, skipping relative and empty entries", async () => {
    const posix = platform("linux", "bin::/opt/a:/opt/b", ["bin/codex", "/opt/b/codex"]);
    expect(await findOnPath(posix, "codex")).toBe("/opt/b/codex");
  });

  it("on Windows counts only an .exe, since a .cmd or .bat shim runs only through a shell", async () => {
    const shim = platform("win32", "C:\\npm;C:\\tools", ["C:\\npm/codex.cmd", "C:\\npm/codex"]);
    expect(await findOnPath(shim, "codex")).toBeUndefined();
    const exe = platform("win32", "C:\\npm;C:\\tools", ["C:\\npm/codex.cmd", "C:\\tools/codex.exe"]);
    expect(await findOnPath(exe, "codex")).toBe("C:\\tools/codex.exe");
  });
});
