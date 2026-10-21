import { allowed, rejects, fresh, type Case } from "./case.ts";

const PI = "@rivus/agent-kit-provider-pi";

export const codexCases: Case[] = [
  allowed(
    "codex: context SPI",
    "providers/codex",
    fresh("src/x"),
    'export { VERSION_FLAG } from "@rivus/agent-kit-discovery/spi";'
  ),
  rejects(
    "codex: no context public entry",
    "providers/codex",
    fresh("src/x"),
    'export { builtinProbeRecipes } from "@rivus/agent-kit-discovery/public";',
    "package-dependency"
  ),
  rejects(
    "codex: no other provider",
    "providers/codex",
    fresh("src/x"),
    `export { pi } from "${PI}/identity";`,
    "package-dependency"
  ),
  rejects(
    "codex: no peer provider by relative path",
    "providers/codex",
    fresh("src/x"),
    'export { pi } from "../../pi/src/identity.js";',
    "relative-escape"
  ),
  rejects(
    "harness: codex is tests-only",
    "harness",
    fresh("src/x"),
    'export { codexHookDialect } from "@rivus/agent-kit-provider-codex/hooks";',
    "package-dependency"
  ),
  rejects(
    "testing: codex is tests-only",
    "testing",
    fresh("src/x"),
    'export { codex } from "@rivus/agent-kit-provider-codex/identity";',
    "package-dependency"
  ),
  rejects(
    "codex: testing is tests-only",
    "providers/codex",
    fresh("src/x"),
    'export { createMemoryPlatform } from "@rivus/agent-kit-testing/public";',
    "package-dependency"
  ),
  allowed("codex hooks: facts", "providers/codex", "src/hooks.ts", 'export { CODEX_ID } from "./facts.js";'),
  allowed(
    "codex hooks: catalog SPI",
    "providers/codex",
    "src/hooks.ts",
    'export { ok } from "@rivus/agent-kit-catalog/spi";'
  ),
  allowed(
    "codex hooks: harness SPI",
    "providers/codex",
    "src/hooks.ts",
    'export { finishSelectorsOf } from "@rivus/agent-kit-harness/spi";'
  ),
  rejects(
    "codex hooks: no installation",
    "providers/codex",
    "src/hooks.ts",
    'export { codexInstallAdapter } from "./install.js";',
    "provider-entry"
  ),
  rejects(
    "codex hooks: no discovery SPI",
    "providers/codex",
    "src/hooks.ts",
    'export { VERSION_FLAG } from "@rivus/agent-kit-discovery/spi";',
    "provider-entry"
  ),
  allowed(
    "shell hooks: codex hooks",
    "agent-kit",
    "src/providers/hooks.ts",
    'export { codexHookDialect } from "@rivus/agent-kit-provider-codex/hooks";'
  ),
  rejects(
    "shell hooks: no codex install",
    "agent-kit",
    "src/providers/hooks.ts",
    'export { codexInstallAdapter } from "@rivus/agent-kit-provider-codex/install";',
    "shell-entry"
  ),
  rejects(
    "shell usage: no codex hooks",
    "agent-kit",
    "src/providers/usage.ts",
    'export { codexHookDialect } from "@rivus/agent-kit-provider-codex/hooks";',
    "shell-entry"
  ),
  allowed("codex usage: layout", "providers/codex", "src/usage.ts", 'export { codexRoots } from "./layout.js";'),
  allowed(
    "codex usage: catalog SPI",
    "providers/codex",
    "src/usage.ts",
    'export { ok } from "@rivus/agent-kit-catalog/spi";'
  ),
  allowed(
    "codex usage: sessions SPI",
    "providers/codex",
    "src/usage.ts",
    'export { readText } from "@rivus/agent-kit-sessions/spi";'
  ),
  rejects(
    "codex usage: no hooks",
    "providers/codex",
    "src/usage.ts",
    'export { codexHookDialect } from "./hooks.js";',
    "provider-entry"
  ),
  rejects(
    "codex usage: no ACP SPI",
    "providers/codex",
    "src/usage.ts",
    'export { BASE_ENV } from "@rivus/agent-kit-acp/spi";',
    "provider-entry"
  ),
  allowed(
    "codex ACP: base environment SPI",
    "providers/codex",
    "src/acp.ts",
    'export { BASE_ENV } from "@rivus/agent-kit-acp/spi";'
  ),
  allowed(
    "shell ACP: codex profile",
    "agent-kit",
    "src/providers/acp.ts",
    'export { codexAcpProfile } from "@rivus/agent-kit-provider-codex/acp";'
  ),
  allowed(
    "shell usage: codex usage",
    "agent-kit",
    "src/providers/usage.ts",
    'export { codexUsageDecoder } from "@rivus/agent-kit-provider-codex/usage";'
  ),
  rejects(
    "shell ACP: no codex usage",
    "agent-kit",
    "src/providers/acp.ts",
    'export { codexUsageDecoder } from "@rivus/agent-kit-provider-codex/usage";',
    "shell-entry"
  ),
  allowed(
    "codex usage: records",
    "providers/codex",
    "src/usage.ts",
    'export { codexUsageLines } from "./records/usage.js";'
  ),
  rejects(
    "codex records: no sessions through usage helper",
    "providers/codex",
    "src/records/usage.ts",
    'export { translateCodexRecords } from "../sessions/events.js";',
    "provider-entry"
  ),
  rejects(
    "codex layout: no sessions through usage helper",
    "providers/codex",
    "src/layout.ts",
    'export { translateCodexRecords } from "./sessions/events.js";',
    "provider-entry"
  ),
  rejects(
    "codex nested records: no sessions",
    "providers/codex",
    fresh("src/records/deep/x"),
    'export { translateCodexRecords } from "../../sessions/events.js";',
    "provider-entry"
  ),
  allowed(
    "codex nested records: shared layout and records",
    "providers/codex",
    fresh("src/records/deep/x"),
    'export { codexRoots } from "../../layout.js"; export { codexUsage } from "../usage.js";'
  ),
  rejects(
    "codex facts: no layout through hooks helper",
    "providers/codex",
    "src/facts.ts",
    'export { codexRoots } from "./layout.js";',
    "provider-entry"
  ),
  rejects(
    "codex facts: no sessions SPI through hooks helper",
    "providers/codex",
    "src/facts.ts",
    'export { readText } from "@rivus/agent-kit-sessions/spi";',
    "provider-entry"
  ),
  rejects(
    "codex usage: no sessions",
    "providers/codex",
    "src/usage.ts",
    'export { translateCodexRecords } from "./sessions/events.js";',
    "provider-entry"
  ),
  allowed(
    "codex sessions: context SPI",
    "providers/codex",
    "src/sessions.ts",
    'export { discoverSessions } from "@rivus/agent-kit-sessions/spi";'
  ),
  rejects(
    "codex: no Platform types",
    "providers/codex",
    fresh("src/x"),
    'export type { Platform } from "@rivus/agent-kit-platform/public";',
    "package-dependency"
  ),
  rejects(
    "codex: no Platform values",
    "providers/codex",
    fresh("src/x"),
    'export { Platform } from "@rivus/agent-kit-platform/public";',
    "package-dependency"
  ),
  allowed(
    "shell sessions: codex adapter",
    "agent-kit",
    "src/providers/sessions.ts",
    'export { codexSessionAdapter } from "@rivus/agent-kit-provider-codex/sessions";'
  ),
  rejects(
    "shell hooks: no codex sessions",
    "agent-kit",
    "src/providers/hooks.ts",
    'export { codexSessionAdapter } from "@rivus/agent-kit-provider-codex/sessions";',
    "shell-entry"
  ),
  rejects(
    "discovery: codex is tests-only",
    "discovery",
    fresh("src/x"),
    'export { codexProbe } from "@rivus/agent-kit-provider-codex/discovery";',
    "package-dependency"
  ),
  allowed(
    "codex usage: fork replay",
    "providers/codex",
    "src/usage.ts",
    'export { stepForkReplay } from "./records/fork-replay.js";'
  ),
  rejects(
    "codex fork replay: no sessions",
    "providers/codex",
    "src/records/fork-replay.ts",
    'export { translateCodexRecords } from "../sessions/events.js";',
    "provider-entry"
  )
];
