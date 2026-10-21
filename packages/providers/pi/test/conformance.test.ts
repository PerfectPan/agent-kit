import { describe, expect, it } from "vite-plus/test";
import {
  createMemoryPlatform,
  hookDialectConformance,
  probeRecipeConformance,
  usageDecoderConformance
} from "@rivus/agent-kit-testing";
import { homeFromRule } from "@rivus/agent-kit-catalog/spi";
import { pi } from "../src/identity.js";
import { piProbe } from "../src/discovery.js";
import { piHookDialect } from "../src/hooks.js";
import { piUsageDecoder } from "../src/usage.js";
import { piSamples } from "./fixtures/hooks.js";
import { readUsageHome } from "./support.js";

const platform = createMemoryPlatform({ files: await readUsageHome("/u/me"), home: "/u/me" });
const fixtures = {
  platform,
  home: homeFromRule("pi", pi.home, { home: "/u/me", env: {} }),
  sources: [
    { path: "/u/me/.pi/agent/sessions/--u-me-work--/2026-01-01T00-00-00-000Z_pi-1.jsonl", records: 2 },
    { path: "/u/me/.pi/agent/sessions/--u-me-work--/2026-01-02T00-00-00-000Z_pi-fork.jsonl", records: 1 }
  ]
};

for (const [service, checks] of [
  ["hooks", hookDialectConformance(piHookDialect, { samples: piSamples }, { pi: piHookDialect })],
  ["discovery", probeRecipeConformance(piProbe, {}, { pi })],
  ["usage", usageDecoderConformance(piUsageDecoder, fixtures)]
] as const) {
  describe(`pi ${service} conformance`, () => {
    for (const { name, run } of checks) {
      it(`${name}`, async () => {
        await expect(run()).resolves.toBeUndefined();
      });
    }
  });
}

it("the usage suite rejects missing sources and incorrect record counts", async () => {
  const missing = usageDecoderConformance(
    {
      ...piUsageDecoder,
      async *sources() {
        yield* [];
      }
    },
    fixtures
  );
  await expect(missing[0]?.run()).rejects.toThrow("source paths differ");
  const incorrect = usageDecoderConformance(piUsageDecoder, {
    ...fixtures,
    sources: fixtures.sources.map((source) => ({ ...source, records: 0 }))
  });
  await expect(incorrect[1]?.run()).rejects.toThrow("decoded record count differs");
});
