import { allowed, rejects, fresh, type Case } from "./case.ts";

const PLATFORM = "@rivus/agent-kit-platform";

export const libCases: Case[] = [
  ...["domain", "application", "infra", "lib"].map((layer) =>
    allowed(
      `harness ${layer}: pure lib helper`,
      "harness",
      fresh(`src/${layer}/x`),
      'export { deepFreeze } from "../lib/deep-freeze.js";'
    )
  ),
  allowed(
    "harness adapters: pure lib helper",
    "harness",
    fresh("src/domain/lifecycle/adapters/x"),
    'export { deepFreeze } from "../../../lib/deep-freeze.js";'
  ),
  allowed("harness lib: pure schema helper", "harness", fresh("src/lib/x"), 'export * as z from "zod/mini";'),
  allowed(
    "harness lib: schema catch keeps its two arguments",
    "harness",
    fresh("src/lib/x"),
    'import * as z from "zod/mini"; export function read(value: unknown): string { return z.parse(z.catch(z.string(), ""), value); }'
  ),
  rejects(
    "harness lib: other npm dependencies stay forbidden",
    "harness",
    fresh("src/lib/x"),
    'export { isPlainObject } from "es-toolkit";',
    "external-dependency"
  ),
  rejects(
    "catalog lib: schema dependency must be declared by the package",
    "catalog",
    fresh("src/lib/x"),
    'export * as z from "zod/mini";',
    "external-dependency"
  ),
  rejects(
    "harness lib: no domain dependency",
    "harness",
    fresh("src/lib/x"),
    'export { Bundle } from "../domain/bundle/value-objects/bundle.js";',
    "layer"
  ),
  rejects(
    "harness lib: no application dependency",
    "harness",
    fresh("src/lib/x"),
    'export { observe } from "../application/services/observe.js";',
    "layer"
  ),
  rejects(
    "harness lib: no infra dependency",
    "harness",
    fresh("src/lib/x"),
    'export { encodeLedger } from "../infra/models/ledger-file.js";',
    "layer"
  ),
  rejects(
    "harness lib: no Platform dependency",
    "harness",
    fresh("src/lib/x"),
    `export type { Platform } from "${PLATFORM}/public";`,
    "layer"
  )
];
