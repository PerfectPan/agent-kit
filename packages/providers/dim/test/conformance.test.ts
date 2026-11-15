import { afterAll, describe, expect, it } from "vite-plus/test";
import {
  hookDialectConformance,
  probeRecipeConformance,
  sessionAdapterConformance,
  usageDecoderConformance
} from "@rivus/agent-kit-testing/public";
import { homeFromRule } from "@rivus/agent-kit-catalog/spi";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodePlatform } from "@rivus/agent-kit-platform-node/public";
import { dim } from "../src/identity.js";
import { dimProbe } from "../src/discovery.js";
import { dimHookDialect } from "../src/hooks.js";
import { dimUsageDecoder } from "../src/usage.js";
import { dimSessionAdapter } from "../src/sessions.js";
import { dimSamples } from "./fixtures/hooks.js";

const ok = (stdout: string, stderr = "") => ({ code: 0, stdout, stderr });

const samples = {
  versions: [{ output: ok("dimcode 0.5.27\n"), version: { output: "dimcode 0.5.27", number: "0.5.27" } }]
};

// A synthetic database with two ledger rows, as the usage conformance fixture home holds.
const work = await mkdtemp(join(tmpdir(), "agent-kit-dim-conformance-"));
afterAll(() => rm(work, { recursive: true, force: true }));
const node = createNodePlatform({ home: work, env: {} });
await mkdir(join(work, "dimcode", "v2"), { recursive: true });
const database = join(work, "dimcode", "v2", "dimcode.sqlite");
const db = node.sqlite!.open(database);
db.exec(
  "CREATE TABLE sessions (sessionId text primary key, cwd text not null default '', title text, status text not null, " +
    "tags text, heldBy text, heldAt text, createdAt text not null, updatedAt text not null, version integer not null)"
);
db.exec(
  "CREATE TABLE usage_ledger (ledgerId text primary key, sessionId text not null, runId text, " +
    "providerId text not null, modelId text not null, usage text not null, cost real, createdAt text not null)"
);
db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, 1)").run(
  "s1",
  "/u/me/work",
  "Reply with exactly: PONG",
  "active",
  "2026-11-13T00:00:00.000Z",
  "2026-11-13T00:01:00.000Z"
);
db.exec(
  "CREATE TABLE messages (messageId text primary key, sessionId text not null, role text not null, parts text not null, " +
    "attachments text, toolMetadata text, metadata text, orderKey text not null, createdAt text not null, updatedAt text not null)"
);
db.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)").run(
  "m1",
  "s1",
  "user",
  '[{"type":"text","text":"Reply with exactly: PONG"}]',
  "{}",
  "01a1d0991a54-0000",
  "2026-11-13T00:00:00.500Z",
  "2026-11-13T00:00:00.500Z"
);
db.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)").run(
  "m2",
  "s1",
  "assistant",
  '[{"type":"text","text":"PONG","startTime":"2026-11-13T00:00:00.900Z","endTime":"2026-11-13T00:00:00.901Z"}]',
  '{"runId":"run-1"}',
  "01a1d0991a96-0001",
  "2026-11-13T00:00:00.901Z",
  "2026-11-13T00:00:00.901Z"
);

const insert = db.prepare("INSERT INTO usage_ledger VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
insert.run(
  "l1",
  "s1",
  "run-1",
  "zhipuai",
  "glm-4.6",
  JSON.stringify({ promptTokens: 10, completionTokens: 4, totalTokens: 14 }),
  0.01,
  "2026-11-13T00:00:00.000Z"
);
insert.run(
  "l2",
  "s1",
  "run-2",
  "deepseek",
  "deepseek-chat",
  JSON.stringify({ promptTokens: 20, completionTokens: 6, totalTokens: 26, cacheReadTokens: 5 }),
  0.02,
  "2026-11-13T00:01:00.000Z"
);
db.close();

const usageFixtures = {
  platform: { fs: node.fs, sqlite: node.sqlite },
  home: homeFromRule("dim", dim.home, { home: work, env: { DIMCODE_HOME: join(work, "dimcode") } }),
  sources: [{ path: database, records: 2 }]
};

const sessionChecks = sessionAdapterConformance(dimSessionAdapter, {
  platform: { fs: node.fs, sqlite: node.sqlite },
  root: database,
  sessions: [
    {
      path: database,
      sessionId: "s1",
      records: 2,
      recordKeys: [`${database}\0${1}`, `${database}\0${2}`],
      capabilities: ["requests", "usage"]
    }
  ]
});

for (const [service, checks] of [
  ["hooks", hookDialectConformance(dimHookDialect, { samples: dimSamples }, { dim: dimHookDialect })],
  ["discovery", probeRecipeConformance(dimProbe, samples, { dim })],
  ["usage", usageDecoderConformance(dimUsageDecoder, usageFixtures)],
  ["sessions", sessionChecks]
] as const) {
  describe(`dim ${service} conformance`, () => {
    for (const { name, run } of checks) {
      it(`${name}`, async () => {
        await expect(run()).resolves.toBeUndefined();
      });
    }
  });
}
