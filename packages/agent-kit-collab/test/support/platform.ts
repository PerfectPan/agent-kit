import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createNodePlatform } from "@rivus/agent-kit/node";
import type { Platform } from "@rivus/agent-kit/platform";

/** The Node platform with an empty environment and a home that does not exist, so no test reads a real agent home. */
export function testPlatform(options: { readonly sqlite?: boolean } = {}): Platform {
  const platform = createNodePlatform({ env: {}, home: "/nonexistent-home" });
  return options.sqlite === false ? { ...platform, sqlite: undefined } : platform;
}

const dirs: string[] = [];

export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-kit-collab-"));
  dirs.push(dir);
  return dir;
}

export function removeTempDirs(): void {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}
