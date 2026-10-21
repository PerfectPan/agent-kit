import { codexCases } from "./provider-codex-cases.ts";
import { claudeCodeCases } from "./provider-claude-code-cases.ts";
import { allowed, rejects, fresh, type Case } from "./case.ts";

const PI = "@rivus/agent-kit-provider-pi";

export const providerCases: Case[] = [
  ...claudeCodeCases,
  ...codexCases,
  rejects(
    "discovery: gemini-cli is tests-only",
    "discovery",
    fresh("src/x"),
    'export { geminiCli } from "@rivus/agent-kit-provider-gemini-cli/identity";',
    "package-dependency"
  ),
  rejects(
    "opencode: Node platform is tests-only",
    "providers/opencode",
    fresh("src/x"),
    'export { createNodePlatform } from "@rivus/agent-kit-platform-node/public";',
    "package-dependency"
  ),
  allowed(
    "grok: context SPI",
    "providers/grok",
    fresh("src/x"),
    'export { VERSION_FLAG } from "@rivus/agent-kit-discovery/spi";'
  ),
  rejects(
    "grok: no context public entry",
    "providers/grok",
    fresh("src/x"),
    'export { builtinProbeRecipes } from "@rivus/agent-kit-discovery/public";',
    "package-dependency"
  ),
  rejects(
    "grok: no other provider",
    "providers/grok",
    fresh("src/x"),
    `export { pi } from "${PI}/identity";`,
    "package-dependency"
  ),
  rejects(
    "grok: no peer provider by relative path",
    "providers/grok",
    fresh("src/x"),
    'export { pi } from "../../pi/src/identity.js";',
    "relative-escape"
  ),
  rejects(
    "harness: grok is tests-only",
    "harness",
    fresh("src/x"),
    'export { grokHookDialect } from "@rivus/agent-kit-provider-grok/hooks";',
    "package-dependency"
  ),
  rejects(
    "testing: grok is tests-only",
    "testing",
    fresh("src/x"),
    'export { grok } from "@rivus/agent-kit-provider-grok/identity";',
    "package-dependency"
  ),
  rejects(
    "grok: testing is tests-only",
    "providers/grok",
    fresh("src/x"),
    'export { createMemoryPlatform } from "@rivus/agent-kit-testing/public";',
    "package-dependency"
  ),
  allowed("grok hooks: facts", "providers/grok", "src/hooks.ts", 'export { GROK_ID } from "./facts.js";'),
  allowed(
    "grok hooks: catalog SPI",
    "providers/grok",
    "src/hooks.ts",
    'export { ok } from "@rivus/agent-kit-catalog/spi";'
  ),
  allowed(
    "grok hooks: harness SPI",
    "providers/grok",
    "src/hooks.ts",
    'export { finishSelectorsOf } from "@rivus/agent-kit-harness/spi";'
  ),
  rejects(
    "grok hooks: no installation",
    "providers/grok",
    "src/hooks.ts",
    'export { grokInstallAdapter } from "./install.js";',
    "provider-entry"
  ),
  rejects(
    "grok hooks: no discovery SPI",
    "providers/grok",
    "src/hooks.ts",
    'export { VERSION_FLAG } from "@rivus/agent-kit-discovery/spi";',
    "provider-entry"
  ),
  allowed(
    "shell hooks: grok hooks",
    "agent-kit",
    "src/providers/hooks.ts",
    'export { grokHookDialect } from "@rivus/agent-kit-provider-grok/hooks";'
  ),
  rejects(
    "shell hooks: no grok install",
    "agent-kit",
    "src/providers/hooks.ts",
    'export { grokInstallAdapter } from "@rivus/agent-kit-provider-grok/install";',
    "shell-entry"
  ),
  rejects(
    "shell usage: no grok hooks",
    "agent-kit",
    "src/providers/usage.ts",
    'export { grokHookDialect } from "@rivus/agent-kit-provider-grok/hooks";',
    "shell-entry"
  ),
  allowed("grok usage: layout", "providers/grok", "src/usage.ts", 'export { grokRoots } from "./layout.js";'),
  allowed(
    "grok usage: catalog SPI",
    "providers/grok",
    "src/usage.ts",
    'export { ok } from "@rivus/agent-kit-catalog/spi";'
  ),
  allowed(
    "grok usage: sessions SPI",
    "providers/grok",
    "src/usage.ts",
    'export { readText } from "@rivus/agent-kit-sessions/spi";'
  ),
  rejects(
    "grok usage: no hooks",
    "providers/grok",
    "src/usage.ts",
    'export { grokHookDialect } from "./hooks.js";',
    "provider-entry"
  ),
  rejects(
    "grok usage: no ACP SPI",
    "providers/grok",
    "src/usage.ts",
    'export { BASE_ENV } from "@rivus/agent-kit-acp/spi";',
    "provider-entry"
  ),
  allowed(
    "grok ACP: base environment SPI",
    "providers/grok",
    "src/acp.ts",
    'export { BASE_ENV } from "@rivus/agent-kit-acp/spi";'
  ),
  allowed(
    "shell ACP: grok profile",
    "agent-kit",
    "src/providers/acp.ts",
    'export { grokAcpProfile } from "@rivus/agent-kit-provider-grok/acp";'
  ),
  allowed(
    "shell usage: grok usage",
    "agent-kit",
    "src/providers/usage.ts",
    'export { grokUsageDecoder } from "@rivus/agent-kit-provider-grok/usage";'
  ),
  rejects(
    "shell ACP: no grok usage",
    "agent-kit",
    "src/providers/acp.ts",
    'export { grokUsageDecoder } from "@rivus/agent-kit-provider-grok/usage";',
    "shell-entry"
  ),
  allowed("grok usage: records", "providers/grok", "src/usage.ts", 'export { grokUsageLines } from "./records.js";'),
  rejects(
    "grok records: no sessions through usage helper",
    "providers/grok",
    "src/records.ts",
    'export { translateGrokRecords } from "./sessions/events.js";',
    "provider-entry"
  ),
  rejects(
    "grok layout: no sessions through usage helper",
    "providers/grok",
    "src/layout.ts",
    'export { translateGrokRecords } from "./sessions/events.js";',
    "provider-entry"
  ),
  rejects(
    "grok nested records: no sessions",
    "providers/grok",
    fresh("src/records/deep/x"),
    'export { translateGrokRecords } from "../../sessions/events.js";',
    "provider-entry"
  ),
  allowed(
    "grok nested records: shared layout and records",
    "providers/grok",
    fresh("src/records/deep/x"),
    'export { grokRoots } from "../../layout.js"; export { grokUsage } from "../../records.js";'
  ),
  rejects(
    "grok facts: no layout through hooks helper",
    "providers/grok",
    "src/facts.ts",
    'export { grokRoots } from "./layout.js";',
    "provider-entry"
  ),
  rejects(
    "grok facts: no sessions SPI through hooks helper",
    "providers/grok",
    "src/facts.ts",
    'export { readText } from "@rivus/agent-kit-sessions/spi";',
    "provider-entry"
  ),
  rejects(
    "grok usage: no sessions",
    "providers/grok",
    "src/usage.ts",
    'export { translateGrokRecords } from "./sessions/events.js";',
    "provider-entry"
  ),
  allowed(
    "grok sessions: context SPI",
    "providers/grok",
    "src/sessions.ts",
    'export { discoverSessions } from "@rivus/agent-kit-sessions/spi";'
  ),
  rejects(
    "grok: Platform types are tests-only",
    "providers/grok",
    fresh("src/x"),
    'export type { Platform } from "@rivus/agent-kit-platform/public";',
    "package-dependency"
  ),
  rejects(
    "grok: no Platform values",
    "providers/grok",
    fresh("src/x"),
    'export { Platform } from "@rivus/agent-kit-platform/public";',
    "package-dependency"
  ),
  allowed(
    "shell sessions: grok adapter",
    "agent-kit",
    "src/providers/sessions.ts",
    'export { grokSessionAdapter } from "@rivus/agent-kit-provider-grok/sessions";'
  ),
  rejects(
    "shell hooks: no grok sessions",
    "agent-kit",
    "src/providers/hooks.ts",
    'export { grokSessionAdapter } from "@rivus/agent-kit-provider-grok/sessions";',
    "shell-entry"
  ),
  allowed(
    "opencode: context SPI",
    "providers/opencode",
    fresh("src/x"),
    'export { VERSION_FLAG } from "@rivus/agent-kit-discovery/spi";'
  ),
  rejects(
    "opencode: no context public entry",
    "providers/opencode",
    fresh("src/x"),
    'export { builtinProbeRecipes } from "@rivus/agent-kit-discovery/public";',
    "package-dependency"
  ),
  rejects(
    "opencode: no other provider",
    "providers/opencode",
    fresh("src/x"),
    `export { pi } from "${PI}/identity";`,
    "package-dependency"
  ),
  rejects(
    "opencode: no peer provider by relative path",
    "providers/opencode",
    fresh("src/x"),
    'export { pi } from "../../pi/src/identity.js";',
    "relative-escape"
  ),
  rejects(
    "harness: opencode is tests-only",
    "harness",
    fresh("src/x"),
    'export { opencodeHookDialect } from "@rivus/agent-kit-provider-opencode/hooks";',
    "package-dependency"
  ),
  rejects(
    "testing: opencode is tests-only",
    "testing",
    fresh("src/x"),
    'export { opencode } from "@rivus/agent-kit-provider-opencode/identity";',
    "package-dependency"
  ),
  rejects(
    "opencode: testing is tests-only",
    "providers/opencode",
    fresh("src/x"),
    'export { createMemoryPlatform } from "@rivus/agent-kit-testing/public";',
    "package-dependency"
  ),
  allowed("opencode hooks: facts", "providers/opencode", "src/hooks.ts", 'export { OPENCODE_ID } from "./facts.js";'),
  allowed(
    "opencode hooks: catalog SPI",
    "providers/opencode",
    "src/hooks.ts",
    'export { ok } from "@rivus/agent-kit-catalog/spi";'
  ),
  allowed(
    "opencode hooks: harness SPI",
    "providers/opencode",
    "src/hooks.ts",
    'export { finishSelectorsOf } from "@rivus/agent-kit-harness/spi";'
  ),
  rejects(
    "opencode hooks: no installation",
    "providers/opencode",
    "src/hooks.ts",
    'export { opencodeInstallAdapter } from "./install.js";',
    "provider-entry"
  ),
  rejects(
    "opencode hooks: no discovery SPI",
    "providers/opencode",
    "src/hooks.ts",
    'export { VERSION_FLAG } from "@rivus/agent-kit-discovery/spi";',
    "provider-entry"
  ),
  allowed(
    "shell hooks: opencode hooks",
    "agent-kit",
    "src/providers/hooks.ts",
    'export { opencodeHookDialect } from "@rivus/agent-kit-provider-opencode/hooks";'
  ),
  rejects(
    "shell hooks: no opencode install",
    "agent-kit",
    "src/providers/hooks.ts",
    'export { opencodeInstallAdapter } from "@rivus/agent-kit-provider-opencode/install";',
    "shell-entry"
  ),
  rejects(
    "shell usage: no opencode hooks",
    "agent-kit",
    "src/providers/usage.ts",
    'export { opencodeHookDialect } from "@rivus/agent-kit-provider-opencode/hooks";',
    "shell-entry"
  ),
  allowed(
    "opencode usage: layout",
    "providers/opencode",
    "src/usage.ts",
    'export { opencodeDatabasePath } from "./layout.js";'
  ),
  allowed(
    "opencode usage: catalog SPI",
    "providers/opencode",
    "src/usage.ts",
    'export { ok } from "@rivus/agent-kit-catalog/spi";'
  ),
  allowed(
    "opencode usage: sessions SPI",
    "providers/opencode",
    "src/usage.ts",
    'export { readText } from "@rivus/agent-kit-sessions/spi";'
  ),
  rejects(
    "opencode usage: no hooks",
    "providers/opencode",
    "src/usage.ts",
    'export { opencodeHookDialect } from "./hooks.js";',
    "provider-entry"
  ),
  rejects(
    "opencode usage: no ACP SPI",
    "providers/opencode",
    "src/usage.ts",
    'export { BASE_ENV } from "@rivus/agent-kit-acp/spi";',
    "provider-entry"
  ),
  allowed(
    "opencode ACP: base environment SPI",
    "providers/opencode",
    "src/acp.ts",
    'export { BASE_ENV } from "@rivus/agent-kit-acp/spi";'
  ),
  allowed(
    "shell ACP: opencode profile",
    "agent-kit",
    "src/providers/acp.ts",
    'export { opencodeAcpProfile } from "@rivus/agent-kit-provider-opencode/acp";'
  ),
  allowed(
    "shell usage: opencode usage",
    "agent-kit",
    "src/providers/usage.ts",
    'export { opencodeUsageDecoder } from "@rivus/agent-kit-provider-opencode/usage";'
  ),
  rejects(
    "shell ACP: no opencode usage",
    "agent-kit",
    "src/providers/acp.ts",
    'export { opencodeUsageDecoder } from "@rivus/agent-kit-provider-opencode/usage";',
    "shell-entry"
  ),
  allowed(
    "gemini-cli: context SPI",
    "providers/gemini-cli",
    fresh("src/x"),
    'export { VERSION_FLAG } from "@rivus/agent-kit-discovery/spi";'
  ),
  rejects(
    "gemini-cli: no context public entry",
    "providers/gemini-cli",
    fresh("src/x"),
    'export { builtinProbeRecipes } from "@rivus/agent-kit-discovery/public";',
    "package-dependency"
  ),
  rejects(
    "gemini-cli: no other provider",
    "providers/gemini-cli",
    fresh("src/x"),
    `export { pi } from "${PI}/identity";`,
    "package-dependency"
  ),
  rejects(
    "gemini-cli: no peer provider by relative path",
    "providers/gemini-cli",
    fresh("src/x"),
    'export { pi } from "../../pi/src/identity.js";',
    "relative-escape"
  ),
  rejects(
    "harness: gemini-cli is tests-only",
    "harness",
    fresh("src/x"),
    'export { geminiCliHookDialect } from "@rivus/agent-kit-provider-gemini-cli/hooks";',
    "package-dependency"
  ),
  rejects(
    "testing: gemini-cli is tests-only",
    "testing",
    fresh("src/x"),
    'export { geminiCli } from "@rivus/agent-kit-provider-gemini-cli/identity";',
    "package-dependency"
  ),
  rejects(
    "gemini-cli: testing is tests-only",
    "providers/gemini-cli",
    fresh("src/x"),
    'export { createMemoryPlatform } from "@rivus/agent-kit-testing/public";',
    "package-dependency"
  ),
  allowed(
    "gemini-cli hooks: facts",
    "providers/gemini-cli",
    "src/hooks.ts",
    'export { GEMINI_CLI_ID } from "./facts.js";'
  ),
  allowed(
    "gemini-cli hooks: catalog SPI",
    "providers/gemini-cli",
    "src/hooks.ts",
    'export { ok } from "@rivus/agent-kit-catalog/spi";'
  ),
  allowed(
    "gemini-cli hooks: harness SPI",
    "providers/gemini-cli",
    "src/hooks.ts",
    'export { finishSelectorsOf } from "@rivus/agent-kit-harness/spi";'
  ),
  rejects(
    "gemini-cli hooks: no installation",
    "providers/gemini-cli",
    "src/hooks.ts",
    'export { geminiCliInstallAdapter } from "./install.js";',
    "provider-entry"
  ),
  rejects(
    "gemini-cli hooks: no discovery SPI",
    "providers/gemini-cli",
    "src/hooks.ts",
    'export { VERSION_FLAG } from "@rivus/agent-kit-discovery/spi";',
    "provider-entry"
  ),
  allowed(
    "shell hooks: gemini-cli hooks",
    "agent-kit",
    "src/providers/hooks.ts",
    'export { geminiCliHookDialect } from "@rivus/agent-kit-provider-gemini-cli/hooks";'
  ),
  rejects(
    "shell hooks: no gemini-cli install",
    "agent-kit",
    "src/providers/hooks.ts",
    'export { geminiCliInstallAdapter } from "@rivus/agent-kit-provider-gemini-cli/install";',
    "shell-entry"
  ),
  rejects(
    "shell usage: no gemini-cli hooks",
    "agent-kit",
    "src/providers/usage.ts",
    'export { geminiCliHookDialect } from "@rivus/agent-kit-provider-gemini-cli/hooks";',
    "shell-entry"
  ),
  allowed(
    "gemini-cli usage: layout",
    "providers/gemini-cli",
    "src/usage.ts",
    'export { geminiCliUsageRoots } from "./layout.js";'
  ),
  allowed(
    "gemini-cli usage: catalog SPI",
    "providers/gemini-cli",
    "src/usage.ts",
    'export { ok } from "@rivus/agent-kit-catalog/spi";'
  ),
  allowed(
    "gemini-cli usage: sessions SPI",
    "providers/gemini-cli",
    "src/usage.ts",
    'export { readText } from "@rivus/agent-kit-sessions/spi";'
  ),
  rejects(
    "gemini-cli usage: no hooks",
    "providers/gemini-cli",
    "src/usage.ts",
    'export { geminiCliHookDialect } from "./hooks.js";',
    "provider-entry"
  ),
  rejects(
    "gemini-cli usage: no ACP SPI",
    "providers/gemini-cli",
    "src/usage.ts",
    'export { BASE_ENV } from "@rivus/agent-kit-acp/spi";',
    "provider-entry"
  ),
  allowed(
    "gemini-cli ACP: base environment SPI",
    "providers/gemini-cli",
    "src/acp.ts",
    'export { BASE_ENV } from "@rivus/agent-kit-acp/spi";'
  ),
  allowed(
    "shell ACP: gemini-cli profile",
    "agent-kit",
    "src/providers/acp.ts",
    'export { geminiCliAcpProfile } from "@rivus/agent-kit-provider-gemini-cli/acp";'
  ),
  allowed(
    "shell usage: gemini-cli usage",
    "agent-kit",
    "src/providers/usage.ts",
    'export { geminiCliUsageDecoder } from "@rivus/agent-kit-provider-gemini-cli/usage";'
  ),
  rejects(
    "shell ACP: no gemini-cli usage",
    "agent-kit",
    "src/providers/acp.ts",
    'export { geminiCliUsageDecoder } from "@rivus/agent-kit-provider-gemini-cli/usage";',
    "shell-entry"
  ),
  allowed(
    "cursor: context SPI",
    "providers/cursor",
    fresh("src/x"),
    'export { VERSION_FLAG } from "@rivus/agent-kit-discovery/spi";'
  ),
  rejects(
    "cursor: no context public entry",
    "providers/cursor",
    fresh("src/x"),
    'export { builtinProbeRecipes } from "@rivus/agent-kit-discovery/public";',
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
    'export { createMemoryPlatform } from "@rivus/agent-kit-testing/public";',
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
    "pi: no context public entry",
    "providers/pi",
    fresh("src/x"),
    'export { builtinProbeRecipes } from "@rivus/agent-kit-discovery/public";',
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
    'export { createMemoryPlatform } from "@rivus/agent-kit-testing/public";',
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
