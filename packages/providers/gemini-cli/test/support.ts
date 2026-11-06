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

import type { ConformanceSession } from "@rivus/agent-kit-testing/public";

/** The Gemini CLI fixture sessions under `root` (the fixtures' `conformance` directory) and what each shows. */
export function geminiSessions(root: string): ConformanceSession[] {
  const at = (path: string) => `${root}/${path}`;
  return [
    {
      path: at("conformance/plain/chats/session-1.jsonl"),
      records: 9,
      capabilities: ["requests", "usage", "reasoning"]
    },
    {
      path: at("conformance/compaction/chats/session-1.jsonl"),
      records: 6,
      capabilities: ["compaction", "compactionTokens"]
    },
    { path: at("conformance/message-update/chats/session-1.jsonl"), records: 5, capabilities: ["requests", "usage"] },
    { path: at("conformance/unknown-type/chats/session-1.jsonl"), records: 2, capabilities: [] }
  ];
}

/** The fixtures directory this package's sessions tests read into a memory platform. */
export function geminiFixtures(): string {
  return fileURLToPath(new URL("fixtures/sessions", import.meta.url));
}
