import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export async function readUsageHome(home: string): Promise<Record<string, Uint8Array>> {
  const root = fileURLToPath(new URL("fixtures/usage", import.meta.url));
  const files: Record<string, Uint8Array> = {};
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const path = join(entry.parentPath, entry.name);
      files[`${home}/.gemini/tmp/${relative(root, path).split(sep).join("/")}`] = await readFile(path);
    }
  }
  return files;
}
