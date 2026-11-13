import { describe, expect, it } from "vite-plus/test";
import { hookDialectConformance, probeRecipeConformance } from "@rivus/agent-kit-testing/public";
import { kimi } from "../src/identity.js";
import { kimiProbe } from "../src/discovery.js";
import { kimiHookDialect } from "../src/hooks.js";
import { kimiSamples } from "./fixtures/hooks.js";

const ok = (stdout: string, stderr = "") => ({ code: 0, stdout, stderr });
const samples = {
  credentialFiles: [
    {
      path: "~/.kimi-code/credentials",
      json: { "kimi-code": { access_token: "x" } },
      reading: { loggedIn: true, method: "oauth" }
    },
    { path: "~/.kimi-code/credentials", json: {}, reading: { loggedIn: false, method: "oauth" } }
  ],
  versions: [{ output: ok("2.6.0\n"), version: { output: "2.6.0", number: "2.6.0" } }]
};
for (const [service, checks] of [
  ["hooks", hookDialectConformance(kimiHookDialect, { samples: kimiSamples }, { kimi: kimiHookDialect })],
  ["discovery", probeRecipeConformance(kimiProbe, samples, { kimi })]
] as const) {
  describe(`kimi ${service} conformance`, () => {
    for (const { name, run } of checks) {
      it(`${name}`, async () => {
        await expect(run()).resolves.toBeUndefined();
      });
    }
  });
}
