import { describe, expect, it } from "vite-plus/test";
import {
  createMemoryPlatform,
  hookDialectConformance,
  probeRecipeConformance,
  usageDecoderConformance
} from "@rivus/agent-kit-testing/public";
import { homeFromRule } from "@rivus/agent-kit-catalog/spi";
import { opencode } from "../src/identity.js";
import { opencodeProbe } from "../src/discovery.js";
import { opencodeHookDialect } from "../src/hooks.js";
import { opencodeUsageDecoder } from "../src/usage.js";
import { opencodeSamples } from "./fixtures/hooks.js";
import { readUsageHome } from "./support.js";

const ok = (stdout: string, stderr = "") => ({ code: 0, stdout, stderr });
const samples = {
  versions: [{ output: ok("1.18.4\n"), version: { output: "1.18.4", number: "1.18.4" } }],
  credentialFiles: [
    {
      path: "~/.local/share/opencode/auth.json",
      json: { anthropic: { type: "oauth", refresh: "r", access: "a", expires: 1 } },
      reading: { loggedIn: true }
    },
    { path: "~/.local/share/opencode/auth.json", json: { broken: { type: "other" } }, reading: { loggedIn: false } }
  ]
};

const platform = createMemoryPlatform({ files: await readUsageHome("/u/me"), home: "/u/me" });
const fixtures = {
  platform,
  home: homeFromRule("opencode", opencode.home, { home: "/u/me", env: {} }),
  sources: [{ path: "/u/me/.local/share/opencode/storage/message/ses_legacy", records: 2 }]
};

for (const [service, checks] of [
  [
    "hooks",
    hookDialectConformance(opencodeHookDialect, { samples: opencodeSamples }, { opencode: opencodeHookDialect })
  ],
  ["discovery", probeRecipeConformance(opencodeProbe, samples, { opencode })],
  ["usage", usageDecoderConformance(opencodeUsageDecoder, fixtures)]
] as const) {
  describe(`opencode ${service} conformance`, () => {
    for (const { name, run } of checks) {
      it(`${name}`, async () => {
        await expect(run()).resolves.toBeUndefined();
      });
    }
  });
}
