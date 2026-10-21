import { allowed, rejects, fresh, type Case } from "./case.ts";

const PI = "@rivus/agent-kit-provider-pi";

export const claudeCodeCases: Case[] = [
  allowed(
    "claude-code: context SPI",
    "providers/claude-code",
    fresh("src/x"),
    'export { VERSION_FLAG } from "@rivus/agent-kit-discovery/spi";'
  ),
  rejects(
    "claude-code: no context index",
    "providers/claude-code",
    fresh("src/x"),
    'export { builtinProbeRecipes } from "@rivus/agent-kit-discovery";',
    "package-dependency"
  ),
  rejects(
    "claude-code: no other provider",
    "providers/claude-code",
    fresh("src/x"),
    `export { pi } from "${PI}/identity";`,
    "package-dependency"
  ),
  rejects(
    "claude-code: no peer provider by relative path",
    "providers/claude-code",
    fresh("src/x"),
    'export { pi } from "../../pi/src/identity.js";',
    "relative-escape"
  ),
  rejects(
    "harness: claude-code is tests-only",
    "harness",
    fresh("src/x"),
    'export { claudeCodeHookDialect } from "@rivus/agent-kit-provider-claude-code/hooks";',
    "package-dependency"
  ),
  rejects(
    "testing: claude-code is tests-only",
    "testing",
    fresh("src/x"),
    'export { claudeCode } from "@rivus/agent-kit-provider-claude-code/identity";',
    "package-dependency"
  ),
  rejects(
    "claude-code: testing is tests-only",
    "providers/claude-code",
    fresh("src/x"),
    'export { createMemoryPlatform } from "@rivus/agent-kit-testing";',
    "package-dependency"
  ),
  allowed(
    "claude-code hooks: facts",
    "providers/claude-code",
    "src/hooks.ts",
    'export { CLAUDE_CODE_ID } from "./facts.js";'
  ),
  allowed(
    "claude-code hooks: catalog SPI",
    "providers/claude-code",
    "src/hooks.ts",
    'export { ok } from "@rivus/agent-kit-catalog/spi";'
  ),
  allowed(
    "claude-code hooks: harness SPI",
    "providers/claude-code",
    "src/hooks.ts",
    'export { finishSelectorsOf } from "@rivus/agent-kit-harness/spi";'
  ),
  rejects(
    "claude-code hooks: no installation",
    "providers/claude-code",
    "src/hooks.ts",
    'export { claudeCodeInstallAdapter } from "./install.js";',
    "provider-entry"
  ),
  rejects(
    "claude-code hooks: no discovery SPI",
    "providers/claude-code",
    "src/hooks.ts",
    'export { VERSION_FLAG } from "@rivus/agent-kit-discovery/spi";',
    "provider-entry"
  ),
  allowed(
    "shell hooks: claude-code hooks",
    "agent-kit",
    "src/providers/hooks.ts",
    'export { claudeCodeHookDialect } from "@rivus/agent-kit-provider-claude-code/hooks";'
  ),
  rejects(
    "shell hooks: no claude-code install",
    "agent-kit",
    "src/providers/hooks.ts",
    'export { claudeCodeInstallAdapter } from "@rivus/agent-kit-provider-claude-code/install";',
    "shell-entry"
  ),
  rejects(
    "shell usage: no claude-code hooks",
    "agent-kit",
    "src/providers/usage.ts",
    'export { claudeCodeHookDialect } from "@rivus/agent-kit-provider-claude-code/hooks";',
    "shell-entry"
  ),
  allowed(
    "claude-code usage: layout",
    "providers/claude-code",
    "src/usage.ts",
    'export { claudeCodeRoots } from "./layout.js";'
  ),
  allowed(
    "claude-code usage: catalog SPI",
    "providers/claude-code",
    "src/usage.ts",
    'export { ok } from "@rivus/agent-kit-catalog/spi";'
  ),
  allowed(
    "claude-code usage: sessions SPI",
    "providers/claude-code",
    "src/usage.ts",
    'export { readText } from "@rivus/agent-kit-sessions/spi";'
  ),
  rejects(
    "claude-code usage: no hooks",
    "providers/claude-code",
    "src/usage.ts",
    'export { claudeCodeHookDialect } from "./hooks.js";',
    "provider-entry"
  ),
  rejects(
    "claude-code usage: no ACP SPI",
    "providers/claude-code",
    "src/usage.ts",
    'export { BASE_ENV } from "@rivus/agent-kit-acp/spi";',
    "provider-entry"
  ),
  allowed(
    "claude-code ACP: base environment SPI",
    "providers/claude-code",
    "src/acp.ts",
    'export { BASE_ENV } from "@rivus/agent-kit-acp/spi";'
  ),
  allowed(
    "shell ACP: claude-code profile",
    "agent-kit",
    "src/providers/acp.ts",
    'export { claudeCodeAcpProfile } from "@rivus/agent-kit-provider-claude-code/acp";'
  ),
  allowed(
    "shell usage: claude-code usage",
    "agent-kit",
    "src/providers/usage.ts",
    'export { claudeCodeUsageDecoder } from "@rivus/agent-kit-provider-claude-code/usage";'
  ),
  rejects(
    "shell ACP: no claude-code usage",
    "agent-kit",
    "src/providers/acp.ts",
    'export { claudeCodeUsageDecoder } from "@rivus/agent-kit-provider-claude-code/usage";',
    "shell-entry"
  ),
  allowed(
    "claude-code usage: records",
    "providers/claude-code",
    "src/usage.ts",
    'export { claudeCodeUsageLines } from "./records/usage.js";'
  ),
  rejects(
    "claude-code records: no sessions through usage helper",
    "providers/claude-code",
    "src/records/usage.ts",
    'export { translateClaudeCodeRecords } from "../sessions/events.js";',
    "provider-entry"
  ),
  rejects(
    "claude-code layout: no sessions through usage helper",
    "providers/claude-code",
    "src/layout.ts",
    'export { translateClaudeCodeRecords } from "./sessions/events.js";',
    "provider-entry"
  ),
  rejects(
    "claude-code nested records: no sessions",
    "providers/claude-code",
    fresh("src/records/deep/x"),
    'export { translateClaudeCodeRecords } from "../../sessions/events.js";',
    "provider-entry"
  ),
  allowed(
    "claude-code nested records: shared layout and records",
    "providers/claude-code",
    fresh("src/records/deep/x"),
    'export { claudeCodeRoots } from "../../layout.js"; export { claudeCodeUsage } from "../usage.js";'
  ),
  rejects(
    "claude-code facts: no layout through hooks helper",
    "providers/claude-code",
    "src/facts.ts",
    'export { claudeCodeRoots } from "./layout.js";',
    "provider-entry"
  ),
  rejects(
    "claude-code facts: no sessions SPI through hooks helper",
    "providers/claude-code",
    "src/facts.ts",
    'export { readText } from "@rivus/agent-kit-sessions/spi";',
    "provider-entry"
  ),
  rejects(
    "claude-code usage: no sessions",
    "providers/claude-code",
    "src/usage.ts",
    'export { translateClaudeCodeRecords } from "./sessions/events.js";',
    "provider-entry"
  ),
  allowed(
    "claude-code sessions: context SPI",
    "providers/claude-code",
    "src/sessions.ts",
    'export { discoverSessions } from "@rivus/agent-kit-sessions/spi";'
  ),
  rejects(
    "claude-code: no Platform types",
    "providers/claude-code",
    fresh("src/x"),
    'export type { Platform } from "@rivus/agent-kit-platform";',
    "package-dependency"
  ),
  rejects(
    "claude-code: no Platform values",
    "providers/claude-code",
    fresh("src/x"),
    'export { Platform } from "@rivus/agent-kit-platform";',
    "package-dependency"
  ),
  allowed(
    "shell sessions: claude-code adapter",
    "agent-kit",
    "src/providers/sessions.ts",
    'export { claudeCodeSessionAdapter } from "@rivus/agent-kit-provider-claude-code/sessions";'
  ),
  rejects(
    "shell hooks: no claude-code sessions",
    "agent-kit",
    "src/providers/hooks.ts",
    'export { claudeCodeSessionAdapter } from "@rivus/agent-kit-provider-claude-code/sessions";',
    "shell-entry"
  )
];
