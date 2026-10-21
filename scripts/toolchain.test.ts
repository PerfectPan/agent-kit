import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { describe, expect, it } from "vite-plus/test";

import { findRepositoryRoot, type PackageManifest } from "./lib/workspace.ts";

// Toolchain upgrade procedure: docs/development/release.md#bot-pull-requests.
const FOLLOWS_VITE_PLUS = ["vite", "vitest"] as const;

function toolchainMismatches(catalog: Readonly<Record<string, string>>, vitePlus: PackageManifest): string[] {
  return FOLLOWS_VITE_PLUS.flatMap((name) => {
    const required = vitePlus.dependencies?.[name] ?? "(none)";
    const actual = catalog[name] ?? "(missing)";
    return actual === required
      ? []
      : [
          `pnpm-workspace.yaml catalog entry ${name} is "${actual}", but the installed vite-plus ${vitePlus.version} ` +
            `depends on "${required}"; set the catalog entry to "${required}" and run pnpm install`
        ];
  });
}

describe("toolchain versions", () => {
  it("use the catalog's vite-plus and its required vitest and vite alias versions", () => {
    const root = findRepositoryRoot();
    const catalog = JSON.parse(
      execFileSync("pnpm", ["config", "get", "catalog", "--json"], { cwd: root, encoding: "utf8" })
    ) as Record<string, string>;
    const vitePlusManifest = createRequire(import.meta.url).resolve("vite-plus/package.json");
    const vitePlus = JSON.parse(readFileSync(vitePlusManifest, "utf8")) as PackageManifest;
    if (vitePlus.version !== catalog["vite-plus"]) {
      throw new Error(
        `Installed vite-plus ${vitePlus.version} does not match pnpm-workspace.yaml catalog vite-plus ` +
          `"${catalog["vite-plus"]}"; run pnpm install`
      );
    }
    expect(toolchainMismatches(catalog, vitePlus)).toEqual([]);
  });
});
