import { allowed, rejects, fresh, type Case } from "./case.ts";

export const siblingEntryCases: Case[] = [
  allowed(
    "testing: the plain harness SPI",
    "testing",
    fresh("src/x"),
    'export { Ledger } from "@rivus/agent-kit-harness/spi";'
  ),
  allowed(
    "testing: the plain harness events entry",
    "testing",
    fresh("src/x"),
    'export { readHookEvent } from "@rivus/agent-kit-harness/public/events";'
  ),
  rejects(
    "testing: an exported harness subentry absent from siblingEntries",
    "testing",
    fresh("src/x"),
    'export type { InstallAdapter } from "@rivus/agent-kit-harness/public/install";',
    "deep-import"
  ),
  rejects(
    "testing: the aggregate harness public entry",
    "testing",
    fresh("src/x"),
    'export { planInstall } from "@rivus/agent-kit-harness/public";',
    "deep-import"
  ),
  ...(
    [
      ["testing", "discovery", "expandProbePath"],
      ["testing", "cost", "costOf"],
      ["providers/spi-probe", "platform-node", "createNodePlatform"],
      ["providers/spi-probe", "testing", "createMemoryPlatform"]
    ] as const
  ).map(([pkg, context, symbol]) =>
    allowed(
      `sibling entry: ${context}/public`,
      pkg,
      fresh("src/x"),
      `export { ${symbol} } from "@rivus/agent-kit-${context}/public";`
    )
  ),
  rejects(
    "a declared dependency's shell-only Effect alias",
    "providers/spi-probe",
    fresh("src/x"),
    'export { aggregateRepositoryConformance } from "@rivus/agent-kit-testing/public/effect";',
    "deep-import"
  ),
  rejects(
    "a public subentry absent from the target exports",
    "sessions",
    fresh("src/application/x"),
    'export { ok } from "@rivus/agent-kit-catalog/public/events";',
    "deep-import"
  )
];
