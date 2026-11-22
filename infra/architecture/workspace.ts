import { execFileSync } from "node:child_process";

/** Lists the workspace members as raw JSON from `pnpm ls -r --depth -1 --json`. */
export function pnpmListJson(root: string): string {
  return execFileSync("pnpm", ["ls", "-r", "--depth", "-1", "--json"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });
}
