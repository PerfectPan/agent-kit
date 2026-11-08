import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { ConformanceSession } from "@rivus/agent-kit-testing/public";

/** The Pi fixture sessions under `root` (the fixtures' `conformance` directory) and what each shows. */
export function piSessions(root: string): ConformanceSession[] {
  const at = (path: string) => `${root}/${path}`;
  return [
    {
      path: at("plain/session.jsonl"),
      records: 8,
      capabilities: ["requests", "usage", "reasoning"]
    },
    {
      path: at("compaction/session.jsonl"),
      records: 8,
      capabilities: ["requests", "usage", "compaction", "compactionTokens"]
    },
    { path: at("unknown-type/session.jsonl"), records: 3, capabilities: [] }
  ];
}

export async function readUsageHome(home: string): Promise<Record<string, Uint8Array>> {
  const root = fileURLToPath(new URL("fixtures/usage", import.meta.url));
  const files: Record<string, Uint8Array> = {};
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const path = join(entry.parentPath, entry.name);
      files[`${home}/.pi/agent/${relative(root, path).split(sep).join("/")}`] = await readFile(path);
    }
  }
  return files;
}
