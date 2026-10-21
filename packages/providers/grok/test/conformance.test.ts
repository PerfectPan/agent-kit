import { describe, expect, it } from "vite-plus/test";
import {
  createMemoryPlatform,
  hookDialectConformance,
  probeRecipeConformance,
  usageDecoderConformance
} from "@rivus/agent-kit-testing/public";
import { homeFromRule } from "@rivus/agent-kit-catalog/spi";
import { grok } from "../src/identity.js";
import { grokProbe } from "../src/discovery.js";
import { grokHookDialect } from "../src/hooks.js";
import { grokUsageDecoder } from "../src/usage.js";
import { grokSamples } from "./fixtures/hooks.js";
import { readUsageHome } from "./support.js";
const ok = (stdout: string, stderr = "") => ({ code: 0, stdout, stderr });
const samples = {
  credentialFiles: [
    {
      path: "~/.grok/auth.json",
      json: { "https://example.invalid/scope": { token: "x" } },
      reading: { loggedIn: true }
    },
    { path: "~/.grok/auth.json", json: {}, reading: { loggedIn: false } }
  ],
  versions: [
    {
      output: ok("grok 1.0.46 (2765805b9442)\n"),
      version: { output: "grok 1.0.46 (2765805b9442)", number: "1.0.46" }
    }
  ]
};
const platform = createMemoryPlatform({ files: await readUsageHome("/u/me"), home: "/u/me" });
const fixtures = {
  platform,
  home: homeFromRule("grok", grok.home, { home: "/u/me", env: {} }),
  sources: [{ path: "/u/me/.grok/sessions/%2Fu%2Fme%2Fwork/gk-usage/updates.jsonl", records: 1 }]
};
for (const [service, checks] of [
  ["hooks", hookDialectConformance(grokHookDialect, { samples: grokSamples }, { grok: grokHookDialect })],
  ["discovery", probeRecipeConformance(grokProbe, samples, { grok })],
  ["usage", usageDecoderConformance(grokUsageDecoder, fixtures)]
] as const) {
  describe(`grok ${service} conformance`, () => {
    for (const { name, run } of checks) {
      it(`${name}`, async () => {
        await expect(run()).resolves.toBeUndefined();
      });
    }
  });
}
