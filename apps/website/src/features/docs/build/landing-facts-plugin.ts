import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

import { budgetsFromLimits, factsFromLimits, supportFromProviders, type SizeLimitEntry } from "../../landing/index.ts";

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

export function landingFactsPlugin() {
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
      const kit = await importSizeLimits("../../../../../../packages/agent-kit/.size-limit.ts");
      const collab = await importSizeLimits("../../../../../../packages/agent-kit-collab/.size-limit.ts");
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
