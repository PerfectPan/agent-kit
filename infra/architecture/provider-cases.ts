import { allowed, rejects, fresh, type Case } from "./case.ts";

const PI = "@rivus/agent-kit-provider-pi";

export const providerCases: Case[] = [
  allowed(
    "cursor: context SPI",
    "providers/cursor",
    fresh("src/x"),
    'export { VERSION_FLAG } from "@rivus/agent-kit-discovery/spi";'
  ),
  rejects(
    "cursor: no context index",
    "providers/cursor",
    fresh("src/x"),
    'export { builtinProbeRecipes } from "@rivus/agent-kit-discovery";',
    "package-dependency"
  ),
  rejects(
    "cursor: no other provider",
    "providers/cursor",
    fresh("src/x"),
    `export { pi } from "${PI}/identity";`,
    "package-dependency"
  ),
  rejects(
    "cursor: no peer provider by relative path",
    "providers/cursor",
    fresh("src/x"),
    'export { pi } from "../../pi/src/identity.js";',
    "relative-escape"
  ),
  rejects(
    "harness: cursor is tests-only",
    "harness",
    fresh("src/x"),
    'export { cursorHookDialect } from "@rivus/agent-kit-provider-cursor/hooks";',
    "package-dependency"
  ),
  rejects(
    "testing: cursor is tests-only",
    "testing",
    fresh("src/x"),
    'export { cursor } from "@rivus/agent-kit-provider-cursor/identity";',
    "package-dependency"
  ),
  rejects(
    "cursor: testing is tests-only",
    "providers/cursor",
    fresh("src/x"),
    'export { createMemoryPlatform } from "@rivus/agent-kit-testing";',
    "package-dependency"
  ),
  allowed("cursor hooks: facts", "providers/cursor", "src/hooks.ts", 'export { CURSOR_ID } from "./facts.js";'),
  allowed(
    "cursor hooks: catalog SPI",
    "providers/cursor",
    "src/hooks.ts",
    'export { ok } from "@rivus/agent-kit-catalog/spi";'
  ),
  allowed(
    "cursor hooks: harness SPI",
    "providers/cursor",
    "src/hooks.ts",
    'export { finishSelectorsOf } from "@rivus/agent-kit-harness/spi";'
  ),
  rejects(
    "cursor hooks: no installation",
    "providers/cursor",
    "src/hooks.ts",
    'export { cursorInstallAdapter } from "./install.js";',
    "provider-entry"
  ),
  rejects(
    "cursor hooks: no discovery SPI",
    "providers/cursor",
    "src/hooks.ts",
    'export { VERSION_FLAG } from "@rivus/agent-kit-discovery/spi";',
    "provider-entry"
  ),
  allowed(
    "shell hooks: cursor hooks",
    "agent-kit",
    "src/providers/hooks.ts",
    'export { cursorHookDialect } from "@rivus/agent-kit-provider-cursor/hooks";'
  ),
  rejects(
    "shell hooks: no cursor install",
    "agent-kit",
    "src/providers/hooks.ts",
    'export { cursorInstallAdapter } from "@rivus/agent-kit-provider-cursor/install";',
    "shell-entry"
  ),
  rejects(
    "shell usage: no cursor hooks",
    "agent-kit",
    "src/providers/usage.ts",
    'export { cursorHookDialect } from "@rivus/agent-kit-provider-cursor/hooks";',
    "shell-entry"
  ),
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
  ...["hooks", "usage"].flatMap((service) => [
    allowed(
      `pi ${service}: catalog SPI`,
      "providers/pi",
      `src/${service}.ts`,
      'export { ok } from "@rivus/agent-kit-catalog/spi";'
    ),
    rejects(
      `slim ${service}: no undeclared npm specifier`,
      "providers/slim-probe",
      `src/${service}.ts`,
      'export { string } from "zod/mini";',
      "external-dependency"
    )
  ]),
  rejects(
    "slim hooks: no undeclared harness SPI",
    "providers/slim-probe",
    "src/hooks.ts",
    'export { finishSelectorsOf } from "@rivus/agent-kit-harness/spi";',
    "spi-import"
  ),
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
