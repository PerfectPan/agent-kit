import { homeFromRule } from "@rivus/agent-kit-catalog/spi";
import type { UsagePlatform } from "@rivus/agent-kit-sessions/public";
import { describe, expect, it } from "vite-plus/test";

import { createNodePlatform } from "@rivus/agent-kit-platform-node/public";
import { createMemoryPlatform, usageDecoderConformance } from "@rivus/agent-kit-testing/public";
import { dsh } from "../src/identity.js";
import { dshUsageDecoder } from "../src/usage.js";
import { plainLines, seededBatches, zstdFile } from "./usage.fixtures.js";

const plainPath = "/u/me/.dsh/sessions/-u-me-work-/plain-1/session.v4.jsonl";
const seededPath = "/u/me/.dsh/sessions/-u-me-work-/seeded-2/session.v4.jsonl.zstd";

// A host with the platform-node `decompress` the shell ships.
const memory = createMemoryPlatform({
  files: {
    [plainPath]: `${plainLines.join("\n")}\n`,
    [seededPath]: zstdFile(...seededBatches)
  },
  chunkSize: 300
});
const platform: UsagePlatform = {
  fs: memory.fs,
  decompress: createNodePlatform().decompress
};

const fixtures = {
  platform,
  home: homeFromRule("dsh", dsh.home, { home: "/u/me", env: {} }),
  sources: [
    { path: plainPath, records: 2 },
    { path: seededPath, records: 1 }
  ]
};

describe("dsh usage conformance", () => {
  for (const { name, run } of usageDecoderConformance(dshUsageDecoder, fixtures)) {
    it(`${name}`, async () => {
      await expect(run()).resolves.toBeUndefined();
    });
  }
});
