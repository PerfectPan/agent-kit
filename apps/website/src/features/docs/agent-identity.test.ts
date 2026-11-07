import { builtinProviders } from "@rivus/agent-kit/providers";
import { expect, it } from "vite-plus/test";

import { AGENT_IDENTITY } from "./agent-identity.ts";

// The support table renders one row per built-in provider and throws inside a Suspense boundary when one has no
// identity, which the prerender reports as a page without its table, not as a failure.
it("lists an identity for every built-in provider", () => {
  expect(new Set(AGENT_IDENTITY.map((agent) => agent.id))).toEqual(
    new Set(builtinProviders.map((provider) => provider.id))
  );
});
