import { describe, expect, it } from "vite-plus/test";
import { hookDialectConformance, probeRecipeConformance, type ProbeRecipeSamples } from "@rivus/agent-kit-testing";
import { cursor } from "../src/identity.js";
import { cursorProbe } from "../src/discovery.js";
import { cursorHookDialect } from "../src/hooks.js";
import { cursorSamples } from "./fixtures/hooks.js";

const ok = (stdout: string, stderr = "") => ({ code: 0, stdout, stderr });
const samples: ProbeRecipeSamples = {
  auth: [
    { output: ok('{"status":"authenticated","isAuthenticated":true}'), reading: { loggedIn: true } },
    { output: ok('{"status":"unauthenticated","isAuthenticated":false}'), reading: { loggedIn: false } },
    { output: { code: 1, stdout: '{"status":"error"}', stderr: "" }, reading: undefined }
  ]
};

for (const [service, checks] of [
  ["hooks", hookDialectConformance(cursorHookDialect, { samples: cursorSamples }, { cursor: cursorHookDialect })],
  ["discovery", probeRecipeConformance(cursorProbe, samples, { cursor })]
] as const) {
  describe(`cursor ${service} conformance`, () => {
    for (const { name, run } of checks) {
      it(`${name}`, async () => {
        await expect(run()).resolves.toBeUndefined();
      });
    }
  });
}
