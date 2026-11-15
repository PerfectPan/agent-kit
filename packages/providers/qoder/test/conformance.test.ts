import { describe, expect, it } from "vite-plus/test";
import { hookDialectConformance, probeRecipeConformance } from "@rivus/agent-kit-testing/public";
import { qoder } from "../src/identity.js";
import { qoderProbe } from "../src/discovery.js";
import { qoderHookDialect } from "../src/hooks.js";
import { qoderSamples } from "./fixtures/hooks.js";

const ok = (stdout: string, stderr = "") => ({ code: 0, stdout, stderr });
const samples = {
  versions: [{ output: ok("1.1.88\n"), version: { output: "1.1.88", number: "1.1.88" } }]
};
for (const [service, checks] of [
  ["hooks", hookDialectConformance(qoderHookDialect, { samples: qoderSamples }, { qoder: qoderHookDialect })],
  ["discovery", probeRecipeConformance(qoderProbe, samples, { qoder })]
] as const) {
  describe(`qoder ${service} conformance`, () => {
    for (const { name, run } of checks) {
      it(`${name}`, async () => {
        await expect(run()).resolves.toBeUndefined();
      });
    }
  });
}
