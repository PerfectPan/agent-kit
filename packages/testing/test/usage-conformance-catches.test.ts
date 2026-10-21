import { expect, it } from "vite-plus/test";
import { homeFromRule } from "@rivus/agent-kit-catalog/public";
import { createMemoryPlatform } from "../src/memory-platform.js";
import { usageDecoderConformance } from "../src/usage-decoder-conformance.js";
import { builtinCodingAgents, builtinUsageDecoders } from "./providers.js";
import { readUsageHome } from "./support.js";

const piUsageDecoder = builtinUsageDecoders.pi;
const fixtures = {
  platform: createMemoryPlatform({ files: await readUsageHome("/u/me"), home: "/u/me" }),
  home: homeFromRule("pi", builtinCodingAgents.pi.home, { home: "/u/me", env: {} }),
  sources: [
    { path: "/u/me/.pi/agent/sessions/--u-me-work--/2026-01-01T00-00-00-000Z_pi-1.jsonl", records: 2 },
    { path: "/u/me/.pi/agent/sessions/--u-me-work--/2026-01-02T00-00-00-000Z_pi-fork.jsonl", records: 1 }
  ]
};

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
