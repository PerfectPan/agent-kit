import { describe, expect, it } from "vite-plus/test";
import { hookDialectConformance, probeRecipeConformance } from "@rivus/agent-kit-testing/public";
import { agyProbe } from "../src/discovery.js";
import { agyHookDialect } from "../src/hooks.js";
import { agy } from "../src/identity.js";
import { agySamples } from "./fixtures/hooks.js";

const ok = (stdout: string, stderr = "") => ({ code: 0, stdout, stderr });
const samples = {
  versions: [{ output: ok("1.5.10\n"), version: { output: "1.5.10", number: "1.5.10" } }]
};
for (const [service, checks] of [
  ["hooks", hookDialectConformance(agyHookDialect, { samples: agySamples }, { agy: agyHookDialect })],
  ["discovery", probeRecipeConformance(agyProbe, samples, { agy })]
] as const) {
  describe(`agy ${service} conformance`, () => {
    for (const { name, run } of checks) {
      it(`${name}`, async () => {
        await expect(run()).resolves.toBeUndefined();
      });
    }
  });
}
