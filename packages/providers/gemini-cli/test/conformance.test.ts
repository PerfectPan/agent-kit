import { describe, expect, it } from "vite-plus/test";
import {
  createMemoryPlatform,
  hookDialectConformance,
  probeRecipeConformance,
  usageDecoderConformance
} from "@rivus/agent-kit-testing/public";
import { homeFromRule } from "@rivus/agent-kit-catalog/spi";
import { geminiCli } from "../src/identity.js";
import { geminiCliProbe } from "../src/discovery.js";
import { geminiCliHookDialect } from "../src/hooks.js";
import { geminiCliUsageDecoder } from "../src/usage.js";
import { geminiCliSamples } from "./fixtures/hooks.js";
import { readUsageHome } from "./support.js";

const platform = createMemoryPlatform({ files: await readUsageHome("/u/me"), home: "/u/me" });
const fixtures = {
  platform,
  home: homeFromRule("gemini-cli", geminiCli.home, { home: "/u/me", env: {} }),
  sources: [
    { path: "/u/me/.gemini/tmp/projhash/chats/gm-1/sub-1.jsonl", records: 1 },
    { path: "/u/me/.gemini/tmp/projhash/chats/session-2026-01-01T00-00-gm1.jsonl", records: 3 },
    { path: "/u/me/.gemini/tmp/projhash/chats/session-legacy.json", records: 1 },
    { path: "/u/me/.gemini/tmp/projhash/chats/session-migrated.jsonl", records: 1 }
  ]
};

for (const [service, checks] of [
  [
    "hooks",
    hookDialectConformance(geminiCliHookDialect, { samples: geminiCliSamples }, { "gemini-cli": geminiCliHookDialect })
  ],
  ["discovery", probeRecipeConformance(geminiCliProbe, {}, { "gemini-cli": geminiCli })],
  ["usage", usageDecoderConformance(geminiCliUsageDecoder, fixtures)]
] as const) {
  describe(`gemini-cli ${service} conformance`, () => {
    for (const { name, run } of checks) {
      it(`${name}`, async () => {
        await expect(run()).resolves.toBeUndefined();
      });
    }
  });
}
