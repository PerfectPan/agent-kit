import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { createFromSource } from "fumadocs-core/search/server";

import { source } from "./source.ts";

// Prerender runs this from the bundled server. Keep the index inside dist so the
// write stays next to the build output the publish script copies.
const target = join(process.cwd(), "dist/.search/search.json");

let pending: Promise<void> | undefined;

/** Export Fumadocs' static search database once per build. The client fetches the copied JSON. */
export function writeSearchIndexOnce(): Promise<void> {
  pending ??= (async () => {
    try {
      const data = await createFromSource(source).export();
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, JSON.stringify(data));
    } catch (error) {
      console.error("writeSearchIndexOnce failed", error);
      throw error;
    }
  })();
  return pending;
}
