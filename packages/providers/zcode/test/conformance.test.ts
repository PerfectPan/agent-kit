import { afterAll, describe, expect, it } from "vite-plus/test";
import { probeRecipeConformance, usageDecoderConformance } from "@rivus/agent-kit-testing/public";
import { homeFromRule } from "@rivus/agent-kit-catalog/spi";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodePlatform } from "@rivus/agent-kit-platform-node/public";
import { zcode } from "../src/identity.js";
import { zcodeProbe } from "../src/discovery.js";
import { zcodeUsageDecoder } from "../src/usage.js";

const ok = (stdout: string, stderr = "") => ({ code: 0, stdout, stderr });

interface MessageRow {
  id: string;
  session_id: string;
  time_created: number;
  data: Record<string, unknown>;
}

const rows = JSON.parse(await readFile(new URL("fixtures/messages.json", import.meta.url), "utf8")) as MessageRow[];

// The credential samples are shapes of the flat record the CLI writes; only key names matter, never values, and the
// version sample is the output of `zcode --version` on the verified install (ZCode 3.16.3, CLI engine 0.17.0).
const samples = {
  versions: [{ output: ok("0.17.0\n"), version: { output: "0.17.0", number: "0.17.0" } }],
  credentialFiles: [
    {
      path: "~/.zcode/v2/credentials.json",
      json: { "oauth:active_provider": "bigmodel", "oauth:bigmodel:access_token": "stored", zcodejwttoken: "stored" },
      reading: { loggedIn: true }
    },
    {
      path: "~/.zcode/v2/credentials.json",
      json: { "oauth:active_provider": "bigmodel", "oauth:bigmodel:refresh_token": "stored" },
      reading: { loggedIn: false }
    },
    { path: "~/.zcode/v2/credentials.json", json: { zcodejwttoken: "" }, reading: { loggedIn: false } }
  ]
};

const work = await mkdtemp(join(tmpdir(), "agent-kit-zcode-conformance-"));
afterAll(() => rm(work, { recursive: true, force: true }));

// A synthetic database with one finished assistant message, as the usage conformance fixture home holds.
const node = createNodePlatform({ home: work, env: {} });
await mkdir(join(work, "storage", "cli", "db"), { recursive: true });
const database = join(work, "storage", "cli", "db", "db.sqlite");
const db = node.sqlite!.open(database);
// Like the usage fixture's schema, without the real table's reference to `session(id)`, which no read depends on.
db.exec(
  "CREATE TABLE message (id text primary key, session_id text not null, time_created integer not null, " +
    "time_updated integer not null, data text not null, sequence integer)"
);
db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?, NULL)").run(
  rows[0]!.id,
  rows[0]!.session_id,
  rows[0]!.time_created,
  rows[0]!.time_created,
  JSON.stringify(rows[0]!.data)
);
db.close();

const fixtures = {
  platform: { fs: node.fs, sqlite: node.sqlite },
  home: homeFromRule("zcode", zcode.home, { home: work, env: { ZCODE_STORAGE_DIR: join(work, "storage") } }),
  sources: [{ path: database, records: 1 }]
};

for (const [service, checks] of [
  ["discovery", probeRecipeConformance(zcodeProbe, samples, { zcode })],
  ["usage", usageDecoderConformance(zcodeUsageDecoder, fixtures)]
] as const) {
  describe(`zcode ${service} conformance`, () => {
    for (const { name, run } of checks) {
      it(`${name}`, async () => {
        await expect(run()).resolves.toBeUndefined();
      });
    }
  });
}
