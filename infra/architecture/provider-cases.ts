import { allowed, rejects, fresh, type Case } from "./case.ts";

const PI = "@rivus/agent-kit-provider-pi";

export const providerCases: Case[] = [
  rejects(
    "pi: no peer provider by relative path",
    "providers/pi",
    fresh("src/x"),
    'export { probeIdentity } from "../../spi-probe/src/identity.js";',
    "relative-escape"
  ),
  allowed(
    "pi: context SPI",
    "providers/pi",
    fresh("src/x"),
    'export { VERSION_FLAG } from "@rivus/agent-kit-discovery/spi";'
  ),
  rejects(
    "pi: no context index",
    "providers/pi",
    fresh("src/x"),
    'export { builtinProbeRecipes } from "@rivus/agent-kit-discovery";',
    "package-dependency"
  ),
  rejects(
    "provider: no other provider",
    "providers/spi-probe",
    fresh("src/x"),
    `export { pi } from "${PI}/identity";`,
    "package-dependency"
  ),
  rejects(
    "context: provider is tests-only",
    "harness",
    fresh("src/x"),
    `export { piHookDialect } from "${PI}/hooks";`,
    "package-dependency"
  ),
  rejects(
    "testing: provider is tests-only",
    "testing",
    fresh("src/x"),
    `export { piUsageDecoder } from "${PI}/usage";`,
    "package-dependency"
  ),
  rejects(
    "pi: testing is tests-only",
    "providers/pi",
    fresh("src/x"),
    'export { createMemoryPlatform } from "@rivus/agent-kit-testing";',
    "package-dependency"
  ),
  allowed("pi hooks: facts", "providers/pi", "src/hooks.ts", 'export { PI_ID } from "./facts.js";'),
  rejects(
    "pi hooks: no installation",
    "providers/pi",
    "src/hooks.ts",
    'export { piInstallAdapter } from "./install.js";',
    "provider-entry"
  ),
  rejects(
    "pi hooks: no sessions SPI",
    "providers/pi",
    "src/hooks.ts",
    'export { readBytes } from "@rivus/agent-kit-sessions/spi";',
    "provider-entry"
  ),
  allowed("pi usage: layout", "providers/pi", "src/usage.ts", 'export { piUsageRoots } from "./layout.js";'),
  rejects(
    "pi usage: no hooks",
    "providers/pi",
    "src/usage.ts",
    'export { piHookDialect } from "./hooks.js";',
    "provider-entry"
  ),
  allowed(
    "shell hooks: provider hooks",
    "agent-kit",
    "src/providers/hooks.ts",
    `export { piHookDialect } from "${PI}/hooks";`
  ),
  allowed(
    "shell usage: provider usage",
    "agent-kit",
    "src/providers/usage.ts",
    `export { piUsageDecoder } from "${PI}/usage";`
  ),
  rejects(
    "shell hooks: no provider usage",
    "agent-kit",
    "src/providers/hooks.ts",
    `export { piUsageDecoder } from "${PI}/usage";`,
    "shell-entry"
  )
];
