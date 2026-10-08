import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/** Every file under `home` by relative path, except harness's own state and the test's `bin`. */
export function snapshotFiles(home: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(home, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    const name = relative(home, path);
    if (entry.isFile() && !name.startsWith(".local/state/") && !name.startsWith("bin/")) {
      files[name] = readFileSync(path, "utf8");
    }
  }
  return files;
}
