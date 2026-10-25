import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { fmt, lint } from "@perfectpan/lint-config/vite-plus";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { defineConfig } from "vite-plus";

import { budgetsFromLimits, factsFromLimits, type SizeLimitEntry } from "./src/lib/entry-budgets.ts";
import { SITE_BASE_PATH } from "./src/lib/site.ts";
import { supportFromProviders } from "./src/lib/support.ts";

const require = createRequire(import.meta.url);
const landingFactsId = "virtual:landing-facts";

/** Node 24 strips types, so the package `.size-limit.ts` modules load as values. */
async function importSizeLimits(relativePath: string): Promise<readonly SizeLimitEntry[]> {
  const url = new URL(relativePath, import.meta.url);
  const imported: unknown = await import(url.href);
  if (
    typeof imported !== "object" ||
    imported === null ||
    !("default" in imported) ||
    !Array.isArray(imported.default)
  ) {
    throw new Error(`Size-limit module ${url.pathname} has no default array`);
  }
  return imported.default.flatMap((entry: unknown): SizeLimitEntry[] => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("name" in entry) ||
      !("limit" in entry) ||
      typeof entry.name !== "string" ||
      typeof entry.limit !== "string"
    ) {
      throw new Error(`Size-limit module ${url.pathname} has an entry without a string name and limit`);
    }
    return [{ name: entry.name, limit: entry.limit }];
  });
}

function landingFactsPlugin() {
  const resolved = `\0${landingFactsId}`;
  return {
    name: "landing-facts",
    resolveId(source: string) {
      if (source === landingFactsId) {
        return resolved;
      }
      return undefined;
    },
    async load(source: string) {
      if (source !== resolved) {
        return undefined;
      }
      const { builtinProviders } = await import("@rivus/agent-kit/providers");
      const kit = await importSizeLimits("../../packages/agent-kit/.size-limit.ts");
      const collab = await importSizeLimits("../../packages/agent-kit-collab/.size-limit.ts");
      const pkg = JSON.parse(readFileSync(require.resolve("@rivus/agent-kit/package.json"), "utf8")) as {
        version: string;
        license: string;
      };
      const facts = {
        support: supportFromProviders(builtinProviders),
        budgets: budgetsFromLimits(kit, collab),
        version: pkg.version,
        license: pkg.license,
        ...factsFromLimits(kit, collab)
      };
      return `export const landingFacts = ${JSON.stringify(facts)};`;
    }
  };
}

export default defineConfig({
  base: `${SITE_BASE_PATH}/`,
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  plugins: [
    landingFactsPlugin(),
    fumadocsMdx(),
    tailwindcss(),
    tanstackStart({
      prerender: {
        enabled: true,
        autoSubfolderIndex: true,
        crawlLinks: true,
        failOnError: true
      },
      pages: [{ path: "/" }, { path: "/zh" }, { path: "/docs" }, { path: "/zh/docs" }],
      router: {
        basepath: SITE_BASE_PATH,
        quoteStyle: "double",
        semicolons: true
      }
    }),
    react()
  ],
  fmt: {
    ...fmt,
    ignorePatterns: ["src/routeTree.gen.ts", ".source/**", "content/docs/en/api/**", "content/docs/zh/api/**"]
  },
  lint: {
    ...lint,
    ignorePatterns: [
      "node_modules/**",
      "dist/**",
      "src/routeTree.gen.ts",
      ".source/**",
      "content/docs/en/api/**",
      "content/docs/zh/api/**"
    ]
  },
  test: {
    passWithNoTests: true
  }
});
