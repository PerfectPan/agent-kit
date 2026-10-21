/**
 * The cases that `run-lint-cases.ts` lints: for every boundary rule of `lint.ts`, violating cases with the one rule
 * id each must report and allowed cases that must report nothing. Paths are package-relative; `fresh` names a new file
 * in the given folder, so a case keeps the folder's layer without editing a real file.
 */
import { dirname } from "node:path";

const PLATFORM = "@rivus/agent-kit-platform";
const CATALOG = "@rivus/agent-kit-catalog";
const SESSIONS = "@rivus/agent-kit-sessions";
const TESTING = "@rivus/agent-kit-testing";
const SHELL = "@rivus/agent-kit";
const COLLAB = "@rivus/agent-kit-collab";

export interface Case {
  readonly name: string;
  /** Package folder under `packages/`. */
  readonly pkg: string;
  /** Package-relative path. A file that exists gets the source appended. */
  readonly path: string;
  readonly source: string;
  readonly expected: readonly string[];
}

let counter = 0;
/** A new file in the directory of `path`, so that the case keeps its layer without touching real files. */
const fresh = (path: string, extension = "ts"): string => `${dirname(path)}/case-${(counter += 1)}.${extension}`;
const allowed = (name: string, pkg: string, path: string, source: string): Case => ({
  name,
  pkg,
  path,
  source,
  expected: []
});
const rejects = (name: string, pkg: string, path: string, source: string, rule: string): Case => ({
  name,
  pkg,
  path,
  source,
  expected: [rule]
});

export const cases: Case[] = [
  ...[
    ["catalog", "CodingAgent"],
    ["discovery", "ProbeRecipe"],
    ["sessions", "SessionAdapter"],
    ["harness", "HookDialect"],
    ["acp", "AcpProfile"],
    ["cost", "Price"]
  ].map(([context, symbol]) =>
    allowed(
      `provider: declared ${context} SPI`,
      "providers/spi-probe",
      fresh("src/x"),
      `export type { ${symbol} } from "@rivus/agent-kit-${context}/spi";`
    )
  ),
  allowed(
    "provider: SPI runtime helper",
    "providers/spi-probe",
    fresh("src/x"),
    `export { readBytes } from "${SESSIONS}/spi";`
  ),
  rejects(
    "provider: SPI-only access rejects the context index",
    "providers/spi-probe",
    fresh("src/x"),
    `export { listSessions } from "${SESSIONS}";`,
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
    'export { Price } from "@rivus/agent-kit-cost/spi";',
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
  ),
  allowed(
    "collab root domain: catalog value",
    "agent-kit-collab",
    fresh("src/domain/x"),
    `export { ok } from "${SHELL}/catalog";`
  ),
  allowed(
    "collab root adapters: zod/mini",
    "agent-kit-collab",
    fresh("src/domain/probe/adapters/x"),
    `export * as z from "zod/mini";`
  ),
  rejects(
    "collab root domain: platform import",
    "agent-kit-collab",
    fresh("src/domain/x"),
    `export { splitLines } from "${SHELL}/platform";`,
    "layer"
  ),
  rejects(
    "collab root domain: npm import",
    "agent-kit-collab",
    fresh("src/domain/x"),
    `export * as z from "zod/mini";`,
    "external-dependency"
  ),
  allowed(
    "shell entry: lowercase numeric hyphenated public subpath",
    "agent-kit",
    fresh("src/x"),
    'export { probe } from "@rivus/agent-kit-harness/public/probe-1";'
  ),
  rejects(
    "shell entry: invalid public subpath",
    "agent-kit",
    fresh("src/x"),
    'export { probe } from "@rivus/agent-kit-harness/public/Foo_Bar.js";',
    "shell-entry"
  ),
  // allowed imports
  allowed(
    "sessions domain: kernel value and type",
    "sessions",
    fresh("src/domain/session/x"),
    `import { ok } from "${CATALOG}";\nimport type { Result } from "${CATALOG}";\nexport const a = [ok] as const;\nexport type R = Result<1, 2>;`
  ),
  allowed(
    "sessions domain: same concept",
    "sessions",
    fresh("src/domain/session/x"),
    `export * as head from "./index.js";`
  ),
  allowed(
    "sessions adapters: domain and kernel",
    "sessions",
    fresh("src/domain/transcript/adapters/codex/x"),
    `export * as s from "../../../session/index.js";\nexport { ok } from "${CATALOG}";`
  ),
  allowed(
    "sessions adapters: another concept's adapters",
    "sessions",
    fresh("src/domain/session/adapters/grok/x"),
    `export * as a from "../../../transcript/adapters/acp-updates.js";`
  ),
  allowed(
    "sessions application: platform and adapters",
    "sessions",
    fresh("src/application/use-cases/x"),
    `export { splitLines } from "${PLATFORM}";\nexport * as a from "../../domain/transcript/adapters/acp-updates.js";`
  ),
  allowed(
    "sessions infra: application",
    "sessions",
    fresh("src/infra/repository/x"),
    `export type * from "../../application/spi.js";`
  ),
  allowed(
    "sessions root: application",
    "sessions",
    fresh("src/x"),
    `export * as u from "./application/use-cases/list-sessions.js";`
  ),
  allowed(
    "platform-node: Node built-ins",
    "platform-node",
    fresh("src/x"),
    `export { readFile } from "node:fs/promises";\nexport * from "${PLATFORM}";`
  ),
  allowed(
    "sessions adapters: zod/mini",
    "sessions",
    fresh("src/domain/transcript/adapters/codex/x"),
    `export * as z from "zod/mini";`
  ),
  allowed(
    "sessions application: es-toolkit",
    "sessions",
    fresh("src/application/x"),
    `export { isPlainObject } from "es-toolkit";`
  ),
  allowed(
    "cost domain: type from sessions (legal)",
    "cost",
    fresh("src/domain/pricing/x"),
    `export type { UsageRecord } from "${SESSIONS}";`
  ),
  allowed(
    "cost root: export type from sessions",
    "cost",
    fresh("src/x"),
    `export type { UsageRecord } from "${SESSIONS}";`
  ),
  allowed("cost root: kernel value", "cost", fresh("src/x"), `export { ok } from "${CATALOG}";`),
  allowed(
    "harness application: Effect",
    "harness",
    fresh("src/application/use-cases/x"),
    `export { Effect } from "effect";`
  ),
  allowed("harness infra: Effect", "harness", fresh("src/infra/repository/x"), `export { Effect } from "effect";`),
  allowed(
    "platform-node effect.ts: Platform service and Layer",
    "platform-node",
    "src/effect.ts",
    `export { PlatformService as CaseService } from "${PLATFORM}/effect";\nexport * as CaseLayer from "effect/Layer";`
  ),
  allowed(
    "harness application: sibling Effect entry",
    "harness",
    fresh("src/application/use-cases/x"),
    `export { PlatformService } from "${PLATFORM}/effect";`
  ),
  allowed(
    "collab lease domain: shell catalog value",
    "agent-kit-collab",
    fresh("src/lease/domain/lease/policies/x"),
    `export { ok } from "${SHELL}/catalog";`
  ),
  allowed(
    "collab lease domain: catalog type and same concept",
    "agent-kit-collab",
    fresh("src/lease/domain/lease/x"),
    `export type { Result } from "${SHELL}/catalog";\nexport * as l from "./policies/loss.js";`
  ),
  allowed(
    "collab lease application: platform Effect entry and Effect",
    "agent-kit-collab",
    fresh("src/lease/application/x"),
    `export { PlatformService } from "${SHELL}/platform/effect";\nexport * as E from "effect/Effect";`
  ),
  allowed(
    "collab lease infra: platform type, zod/mini, other entry's application",
    "agent-kit-collab",
    fresh("src/lease/infra/adapters/x"),
    `export type { Platform } from "${SHELL}/platform";\nexport * as z from "zod/mini";\nexport type * from "../../../process-lock/application/ports.js";`
  ),
  allowed(
    "collab process-lock application: lease domain",
    "agent-kit-collab",
    fresh("src/process-lock/application/x"),
    `export * as l from "../../lease/domain/lease/index.js";`
  ),
  allowed(
    "collab lease entry file: its application",
    "agent-kit-collab",
    fresh("src/lease/x"),
    `export type * from "./application/ports.js";`
  ),
  allowed(
    "shell entry: lighter public entry",
    "agent-kit",
    fresh("src/x"),
    `export { readHookEvent } from "@rivus/agent-kit-harness/public/events";`
  ),
  allowed(
    "acp wire.ts: the SDK behind one module",
    "acp",
    "src/application/services/wire.ts",
    `export * as CaseSdk from "@agentclientprotocol/sdk";`
  ),
  allowed("acp application: platform", "acp", fresh("src/application/x"), `export { splitLines } from "${PLATFORM}";`),
  allowed(
    "dynamic import with a literal",
    "sessions",
    fresh("src/application/x"),
    `export const loaded = await import("./spi.js");`
  ),

  // violations in sessions
  rejects(
    "node:* in a domain file",
    "sessions",
    fresh("src/domain/session/x"),
    `export { readFile } from "node:fs";`,
    "node-builtin"
  ),
  rejects(
    "a bare Node built-in in application/",
    "sessions",
    fresh("src/application/x"),
    `export { join } from "path";`,
    "node-builtin"
  ),
  rejects(
    "Node types in an adapters file",
    "sessions",
    fresh("src/domain/transcript/adapters/codex/x"),
    `export type { Readable } from "node:stream";`,
    "node-builtin"
  ),
  rejects(
    "Effect in an adapters file",
    "sessions",
    fresh("src/domain/session/adapters/codex/x"),
    `export { Effect } from "effect";`,
    "effect"
  ),
  rejects(
    "Effect in a pure package",
    "sessions",
    fresh("src/application/x"),
    `export { Effect } from "effect";`,
    "effect"
  ),
  rejects(
    "Effect types in a pure package",
    "sessions",
    fresh("src/domain/x"),
    `export type { Effect } from "effect/Effect";`,
    "effect"
  ),
  rejects(
    "a deep import into another package's domain/",
    "sessions",
    fresh("src/application/x"),
    `export { id } from "${CATALOG}/src/domain/coding-agent/index.js";`,
    "deep-import"
  ),
  rejects(
    "a sibling importing a public entry",
    "sessions",
    fresh("src/application/x"),
    `export { ok } from "${CATALOG}/public";`,
    "deep-import"
  ),
  rejects(
    "a relative import into another package",
    "sessions",
    fresh("src/application/x"),
    `export * as c from "../../../catalog/src/domain/coding-agent/index.js";`,
    "relative-escape"
  ),
  rejects(
    "a value import from a non-kernel package in domain/",
    "sessions",
    fresh("src/domain/x"),
    `export { splitLines } from "${PLATFORM}";`,
    "layer"
  ),
  rejects(
    "an inline type modifier in domain/",
    "sessions",
    fresh("src/domain/x"),
    `import { type Platform } from "${PLATFORM}";\nexport type P = Platform;`,
    "layer"
  ),
  rejects(
    "an adapters file importing application/",
    "sessions",
    fresh("src/domain/transcript/adapters/codex/x"),
    `export type * from "../../../../application/spi.js";`,
    "layer"
  ),
  rejects(
    "an adapters file importing a non-kernel package",
    "sessions",
    fresh("src/domain/transcript/adapters/codex/x"),
    `export type { Platform } from "${PLATFORM}";`,
    "layer"
  ),
  rejects(
    "a concept importing its own adapters/",
    "sessions",
    fresh("src/domain/session/x"),
    `export * as c from "./adapters/codex/layout.js";`,
    "layer"
  ),
  rejects(
    "a concept importing another concept's adapters/",
    "sessions",
    fresh("src/domain/transcript/x"),
    `export * as g from "../session/adapters/grok/preview.js";`,
    "layer"
  ),
  rejects(
    "zod/mini at the legacy src/domain/adapters/ path",
    "sessions",
    fresh("src/domain/adapters/x"),
    `export * as z from "zod/mini";`,
    "external-dependency"
  ),
  rejects(
    "domain/ importing the package root",
    "sessions",
    fresh("src/domain/x"),
    `export * as p from "../public.js";`,
    "layer"
  ),
  rejects(
    "an undeclared package dependency",
    "sessions",
    fresh("src/application/x"),
    `export { m } from "${TESTING}";`,
    "package-dependency"
  ),
  rejects(
    "an npm package outside the allowlist",
    "sessions",
    fresh("src/application/x"),
    `export { groupBy } from "lodash-es";`,
    "external-dependency"
  ),
  rejects(
    "a computed dynamic import",
    "sessions",
    fresh("src/application/x"),
    `const name = "./ports.js";\nexport const m = await import(name);`,
    "dynamic-import"
  ),
  rejects(
    "Platform types in domain/",
    "sessions",
    fresh("src/domain/x"),
    `import type { Platform } from "${PLATFORM}";\nexport type P = Platform;`,
    "layer"
  ),
  rejects(
    "a Platform type re-export in domain/",
    "sessions",
    fresh("src/domain/x"),
    `export type { FileStat } from "${PLATFORM}";`,
    "layer"
  ),
  rejects(
    "zod's full entry where only zod/mini is allowed",
    "sessions",
    fresh("src/domain/transcript/adapters/codex/x"),
    `export { z } from "zod";`,
    "external-dependency"
  ),
  rejects(
    "another zod subpath",
    "sessions",
    fresh("src/domain/transcript/adapters/codex/x"),
    `export * as z from "zod/v4/classic";`,
    "external-dependency"
  ),
  rejects(
    "es-toolkit's lodash-compatible layer",
    "sessions",
    fresh("src/application/x"),
    `export { get } from "es-toolkit/compat";`,
    "external-dependency"
  ),
  rejects(
    "a package importing itself by name",
    "sessions",
    fresh("src/application/x"),
    `export * from "${SESSIONS}";`,
    "package-dependency"
  ),
  rejects(
    "cost domain: value from sessions",
    "cost",
    fresh("src/domain/pricing/x"),
    `export { decodeUsage } from "${SESSIONS}";`,
    "layer"
  ),
  rejects(
    "cost root: value re-export from sessions",
    "cost",
    fresh("src/x"),
    `export { decodeUsage } from "${SESSIONS}";`,
    "types-only"
  ),
  rejects("cost root: export * from sessions", "cost", fresh("src/x"), `export * from "${SESSIONS}";`, "types-only"),
  rejects(
    "cost root: inline type modifier from sessions",
    "cost",
    fresh("src/x"),
    `import { type UsageRecord } from "${SESSIONS}";\nexport type U = UsageRecord;`,
    "types-only"
  ),
  rejects(
    "harness domain: Effect",
    "harness",
    fresh("src/domain/ledger/x"),
    `export { Effect } from "effect";`,
    "effect"
  ),
  rejects(
    "harness events.ts: Effect",
    "harness",
    "src/events.ts",
    `export { Effect as CaseEffect } from "effect";`,
    "effect"
  ),

  // Effect entries
  rejects(
    "Effect in the plain Platform port",
    "platform",
    fresh("src/x"),
    `export type { Effect } from "effect/Effect";`,
    "effect"
  ),
  rejects(
    "Effect in the plain Node platform",
    "platform-node",
    fresh("src/x"),
    `export * as Layer from "effect/Layer";`,
    "effect"
  ),
  rejects(
    "a sibling's Effect entry in a plain package",
    "sessions",
    fresh("src/application/x"),
    `export { PlatformService } from "${PLATFORM}/effect";`,
    "effect"
  ),
  rejects(
    "a sibling's Effect entry in an Effect context's domain/",
    "harness",
    fresh("src/domain/lifecycle/x"),
    `export type { PlatformService } from "${PLATFORM}/effect";`,
    "effect"
  ),
  rejects(
    "the shell's Effect entry of a sibling",
    "harness",
    fresh("src/application/x"),
    `export { PlatformService } from "${PLATFORM}/public/effect";`,
    "deep-import"
  ),
  rejects(
    "a plain public entry re-exporting the package's Effect entry",
    "platform",
    "src/public.ts",
    `export { PlatformService as CaseService } from "./effect.js";`,
    "effect"
  ),
  rejects(
    "the sibling surface re-exporting it",
    "platform",
    "src/index.ts",
    `export * as CaseEffect from "./effect";`,
    "effect"
  ),
  rejects(
    "a plain module importing its types",
    "platform",
    fresh("src/x"),
    `import type { PlatformService } from "./effect.ts";\nexport type S = PlatformService;`,
    "effect"
  ),
  rejects(
    "the Node platform importing its Layer",
    "platform-node",
    fresh("src/x"),
    `export { NodePlatformLive } from "./effect.js";`,
    "effect"
  ),

  // collab
  rejects(
    "collab: Platform types in its domain/",
    "agent-kit-collab",
    fresh("src/lease/domain/lease/x"),
    `export type { Platform } from "${SHELL}/platform";`,
    "layer"
  ),
  rejects(
    "collab: the Platform service in the plain process lock",
    "agent-kit-collab",
    fresh("src/process-lock/application/x"),
    `export { PlatformService } from "${SHELL}/platform/effect";`,
    "effect"
  ),
  rejects(
    "collab: Effect in the plain process lock",
    "agent-kit-collab",
    fresh("src/process-lock/application/x"),
    `export * as Effect from "effect";`,
    "effect"
  ),
  rejects(
    "collab: an agent-kit entry outside publicImports",
    "agent-kit-collab",
    fresh("src/lease/infra/adapters/x"),
    `export { createNodePlatform } from "${SHELL}/node";`,
    "public-entry"
  ),
  rejects(
    "collab: agent-kit's internal packages",
    "agent-kit-collab",
    fresh("src/lease/application/x"),
    `export { ok } from "${CATALOG}";`,
    "package-dependency"
  ),
  rejects(
    "collab: a layer violation inside an entry folder",
    "agent-kit-collab",
    fresh("src/lease/domain/lease/x"),
    `export type * from "../../application/ports.js";`,
    "layer"
  ),
  rejects(
    "collab: a Node built-in",
    "agent-kit-collab",
    fresh("src/process-lock/application/x"),
    `export { open } from "node:fs/promises";`,
    "node-builtin"
  ),
  rejects(
    "shell: re-export of collab",
    "agent-kit",
    fresh("src/x"),
    `export { acquireProcessLock } from "${COLLAB}/public";`,
    "shell-entry"
  ),
  rejects(
    "other packages: a shell entry",
    "sessions",
    fresh("src/application/x"),
    `export { ok } from "${SHELL}/catalog";`,
    "public-entry"
  ),

  // source files, external-only-in, tests-only, shell entries
  rejects(
    "a declaration file under src/",
    "sessions",
    fresh("src/domain/x", "d.ts"),
    `export * from "../application/spi.js";`,
    "source-file"
  ),
  rejects(
    "a JavaScript file under src/",
    "sessions",
    fresh("src/domain/x", "js"),
    `export * from "../application/spi.js";`,
    "source-file"
  ),
  rejects(
    "an .mts file under src/",
    "sessions",
    fresh("src/application/x", "mts"),
    `export * from "./spi.js";`,
    "source-file"
  ),
  rejects(
    "acp: the SDK outside wire.ts",
    "acp",
    fresh("src/application/x"),
    `export * as acp from "@agentclientprotocol/sdk";`,
    "external-dependency"
  ),
  rejects(
    "acp: the SDK in infra",
    "acp",
    fresh("src/infra/repository/x"),
    `export * as acp from "@agentclientprotocol/sdk";`,
    "external-dependency"
  ),
  rejects(
    "acp: a tests-only dependency",
    "acp",
    fresh("src/application/x"),
    `export { createNodePlatform } from "@rivus/agent-kit-platform-node";`,
    "package-dependency"
  ),
  rejects(
    "harness: a tests-only dependency",
    "harness",
    fresh("src/application/x"),
    `export { createNodePlatform } from "@rivus/agent-kit-platform-node";`,
    "package-dependency"
  ),
  rejects(
    "shell entry: re-export from a non-public entry",
    "agent-kit",
    fresh("src/x"),
    `export { readHookEvent } from "@rivus/agent-kit-harness/events";`,
    "shell-entry"
  ),
  rejects("shell entry: export *", "agent-kit", fresh("src/x"), `export * from "${PLATFORM}/public";`, "shell-entry"),
  rejects(
    "shell entry: a re-export from index.ts",
    "agent-kit",
    fresh("src/x"),
    `export { splitLines } from "${PLATFORM}";`,
    "shell-entry"
  ),
  rejects(
    "shell entry: a re-export from a non-workspace package",
    "agent-kit",
    fresh("src/x"),
    `export { z } from "zod/mini";`,
    "shell-entry"
  ),
  rejects(
    "shell entry: local code",
    "agent-kit",
    fresh("src/x"),
    `import { splitLines } from "${PLATFORM}/public";\nexport const split = splitLines;`,
    "shell-entry"
  ),

  // the agent-marker rule
  rejects(
    "agent marker: a string literal",
    "sessions",
    fresh("src/application/x"),
    `export const id = "codex";`,
    "agent-marker"
  ),
  rejects(
    "agent marker: a home directory",
    "discovery",
    fresh("src/application/x"),
    `export const dir = ".claude";`,
    "agent-marker"
  ),
  rejects(
    "agent marker: an environment variable",
    "acp",
    fresh("src/application/x"),
    `export const name = "CLAUDE_CONFIG_DIR";`,
    "agent-marker"
  ),
  rejects(
    "agent marker: a literal type",
    "harness",
    fresh("src/domain/lifecycle/x"),
    `export type Host = "grok";`,
    "agent-marker"
  ),
  rejects(
    "agent marker: an environment variable as a literal type",
    "cost",
    fresh("src/domain/pricing/x"),
    `export type Variable = "CURSOR_VERSION";`,
    "agent-marker"
  ),
  rejects(
    "agent marker: a template literal",
    "sessions",
    fresh("src/application/x"),
    "export const id = `claude-code`;",
    "agent-marker"
  ),
  rejects(
    "agent marker: a path segment of a template literal",
    "discovery",
    fresh("src/application/x"),
    'const home = "/virtual/home";\nexport const settings = `${home}/.claude/settings.json`;',
    "agent-marker"
  ),
  rejects(
    "agent marker: a segment between expressions",
    "catalog",
    fresh("src/domain/x"),
    "const n = 1;\nexport const id = `${n}/pi/${n}`;",
    "agent-marker"
  ),
  allowed(
    "agent marker: comments",
    "sessions",
    fresh("src/application/x"),
    `// codex, "claude-code" and \`pi\` in a comment\n/** "cursor", ".claude" */\nexport const n = 1;`
  ),
  allowed(
    "agent marker: a substring of a longer string",
    "sessions",
    fresh("src/application/x"),
    `export const id = "codex-cli";\nexport const reason = "invalid-cursor";\nexport const settings = "~/.claude/settings.json";`
  ),
  allowed(
    "agent marker: template segments that only contain a marker",
    "sessions",
    fresh("src/application/x"),
    "const n = 1;\nexport const id = `${n}/codex-cli/${n}-pi/.claude-x`;"
  ),
  rejects(
    "agent marker: a static part of a template literal next to an expression",
    "acp",
    fresh("src/application/x"),
    "const n = 1;\nexport const id = `${n}codex`;",
    "agent-marker"
  ),
  rejects(
    "agent marker: an import specifier is left to the boundary rules",
    "sessions",
    fresh("src/application/x"),
    `export * from "codex";`,
    "external-dependency"
  ),
  rejects(
    "agent marker: an import() specifier is left to the boundary rules",
    "harness",
    fresh("src/application/x"),
    `export const loaded = await import("pi");`,
    "external-dependency"
  ),
  rejects(
    "agent marker: an import() template specifier is left to the dynamic-import rule",
    "harness",
    fresh("src/application/x"),
    "export const loaded = await import(`pi`);",
    "dynamic-import"
  ),
  rejects(
    "agent marker: an import() type specifier is left to the boundary rules",
    "cost",
    fresh("src/domain/pricing/x"),
    `export type C = typeof import("cursor");`,
    "external-dependency"
  ),
  allowed(
    "agent marker: a domain adapters folder",
    "sessions",
    fresh("src/domain/session/adapters/x"),
    `export const id = "codex";`
  ),
  allowed(
    "agent marker: catalog's adapters folder",
    "catalog",
    fresh("src/domain/coding-agent/adapters/x"),
    `export const id = "cursor";`
  ),
  allowed(
    "agent marker: sessions session-adapters",
    "sessions",
    fresh("src/application/services/session-adapters/x"),
    `export const id = "codex";`
  ),
  allowed(
    "agent marker: sessions usage-decoders",
    "sessions",
    fresh("src/application/services/usage-decoders/x"),
    `export const id = "gemini-cli";`
  ),
  allowed(
    "agent marker: harness host-sniffing.ts",
    "harness",
    "src/domain/lifecycle/policies/host-sniffing.ts",
    `export const caseHost = "opencode";`
  ),
  allowed(
    "agent marker: catalog's id unions",
    "catalog",
    "src/domain/coding-agent/value-objects/coding-agent-id.ts",
    `export type CaseId = "pi";`
  ),
  rejects(
    "agent marker: the host-sniffing exemption is one file",
    "harness",
    fresh("src/domain/lifecycle/policies/x"),
    `export const host = "grok";`,
    "agent-marker"
  ),
  rejects(
    "agent marker: the sessions exemptions are per package",
    "discovery",
    fresh("src/application/services/session-adapters/x"),
    `export const id = "codex";`,
    "agent-marker"
  ),
  allowed(
    "agent marker: a test file",
    "sessions",
    `src/application/case-${(counter += 1)}.test.ts`,
    `export const id = "codex";`
  ),
  allowed(
    "agent marker: a package outside the six contexts",
    "testing",
    fresh("src/x"),
    `export const agents = ["claude-code"];`
  ),

  // import forms beyond import/export declarations
  rejects(
    "an import() type of an undeclared package",
    "sessions",
    fresh("src/application/x"),
    `export type T = typeof import("${TESTING}");`,
    "package-dependency"
  ),
  rejects(
    "an import() type of the Platform in domain/",
    "sessions",
    fresh("src/domain/x"),
    `export type P = import("${PLATFORM}").Platform;`,
    "layer"
  ),
  rejects(
    "an import() type of a Node built-in",
    "sessions",
    fresh("src/application/x"),
    `export type R = import("node:stream").Readable;`,
    "node-builtin"
  ),
  allowed(
    "an import() type from a declared package in domain/",
    "cost",
    fresh("src/domain/pricing/x"),
    `export type U = import("${SESSIONS}").UsageRecord;`
  ),
  allowed(
    "platform-node: an import() type of a prefix-only built-in",
    "platform-node",
    fresh("src/x"),
    `export type S = typeof import("node:sqlite");`
  ),
  rejects(
    "an import() type of a prefix-only built-in",
    "sessions",
    fresh("src/application/x"),
    `export type S = typeof import("node:sqlite");`,
    "node-builtin"
  ),
  rejects(
    "an import of a prefix-only built-in",
    "sessions",
    fresh("src/application/x"),
    `export { DatabaseSync } from "node:sqlite";`,
    "node-builtin"
  ),
  rejects(
    "import = require() of an undeclared package",
    "sessions",
    fresh("src/application/x"),
    `import t = require("${TESTING}");\nexport const m = t;`,
    "package-dependency"
  ),

  // resolution
  rejects(
    "a relative import that resolves to no file",
    "sessions",
    fresh("src/application/x"),
    `export * from "./does-not-exist.js";`,
    "unresolved"
  ),
  rejects(
    "a misspelled workspace package",
    "sessions",
    fresh("src/application/x"),
    `export * from "@rivus/agent-kit-catalgo";`,
    "external-dependency"
  ),
  rejects("a syntax error", "sessions", fresh("src/application/x"), "export const = ;", "parse")
];
