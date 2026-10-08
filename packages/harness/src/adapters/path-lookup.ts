import type { Platform } from "@rivus/agent-kit-platform";

/**
 * The first regular file named `command` in the absolute directories of the platform's `PATH`, without a shell and
 * without the working directory. On Windows only `<command>.exe` counts: `Platform.process.run` starts no shell, and
 * Node runs a `.cmd` or `.bat` shim, as npm installs agents, only through one.
 */
export async function findOnPath(
  platform: Pick<Platform, "env" | "os" | "fs">,
  command: string
): Promise<string | undefined> {
  const windows = platform.os === "win32";
  const path = platform.env.PATH ?? platform.env.Path ?? "";
  const names = windows ? [`${command}.exe`] : [command];
  for (const dir of path.split(windows ? ";" : ":")) {
    if (!(dir.startsWith("/") || /^[A-Za-z]:[\\/]/.test(dir))) {
      continue;
    }
    for (const name of names) {
      const candidate = `${dir.replace(/[\\/]+$/, "")}/${name}`;
      const stat = await platform.fs.stat(candidate, { followSymlinks: true }).catch(() => undefined);
      if (stat?.kind === "file") {
        return candidate;
      }
    }
  }
  return undefined;
}
