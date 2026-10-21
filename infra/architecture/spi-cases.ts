import { allowed, rejects, fresh, type Case } from "./case.ts";
const SESSIONS = "@rivus/agent-kit-sessions";
const CATALOG = "@rivus/agent-kit-catalog";
const PLATFORM = "@rivus/agent-kit-platform";

export const spiCases: Case[] = [
  ...[
    ["catalog", "CodingAgent"],
    ["discovery", "ProbeRecipe"],
    ["sessions", "SessionAdapter"],
    ["harness", "HookDialect"],
    ["acp", "AcpProfile"]
  ].map(([context, symbol]) =>
    allowed(
      `provider: declared ${context} SPI`,
      "providers/spi-probe",
      fresh("src/x"),
      `export type { ${symbol} } from "@rivus/agent-kit-${context}/spi";`
    )
  ),
  allowed(
    "provider: catalog SPI result helpers",
    "providers/spi-probe",
    fresh("src/x"),
    `export { ok, err, AgentKitError } from "${CATALOG}/spi";`
  ),
  allowed(
    "provider: SPI runtime helper",
    "providers/spi-probe",
    fresh("src/x"),
    `export { readBytes } from "${SESSIONS}/spi";`
  ),
  rejects(
    "provider: SPI-only access rejects the context public entry",
    "providers/spi-probe",
    fresh("src/x"),
    `export { listSessions } from "${SESSIONS}/public";`,
    "package-dependency"
  ),
  rejects(
    "provider: declared SPI does not expose deep paths",
    "providers/spi-probe",
    fresh("src/x"),
    `export type { SessionAdapter } from "${SESSIONS}/application/spi";`,
    "deep-import"
  ),
  rejects(
    "provider: SPI access keeps type-only restriction",
    "providers/spi-probe",
    fresh("src/x"),
    'export { BASE_ENV } from "@rivus/agent-kit-acp/spi";',
    "types-only"
  ),
  rejects(
    "provider: SPI access keeps layer restriction",
    "providers/spi-probe",
    fresh("src/domain/probe/x"),
    `export { readBytes } from "${SESSIONS}/spi";`,
    "layer"
  ),
  rejects(
    "provider: dependency without an SPI entry",
    "providers/spi-probe",
    fresh("src/x"),
    `export type { Platform } from "${PLATFORM}/spi";`,
    "spi-import"
  ),
  ...["acp", "cost"].map((pkg) =>
    rejects(
      `${pkg}: normal dependency grants no sibling SPI access`,
      pkg,
      fresh("src/x"),
      `export type { SessionAdapter } from "${SESSIONS}/spi";`,
      "spi-import"
    )
  ),
  rejects(
    "sessions: kernel dependency grants no SPI access",
    "sessions",
    fresh("src/application/x"),
    `export type { CodingAgent } from "${CATALOG}/spi";`,
    "spi-import"
  ),
  rejects(
    "shell entry: context SPI",
    "agent-kit",
    fresh("src/x"),
    `export type { SessionAdapter } from "${SESSIONS}/spi";`,
    "shell-entry"
  )
];
