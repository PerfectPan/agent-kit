import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseSync } from "oxc-parser";
import { expect, it } from "vite-plus/test";

import type { Provider } from "../src/providers.js";

type OrdinaryService = Exclude<keyof Provider, "id" | "usage">;
const services = new Map<string, OrdinaryService>([
  ["identityTable", "identity"],
  ["discoveryTable", "discovery"],
  ["hooksTable", "hooks"],
  ["installTable", "install"],
  ["sessionsTable", "sessions"],
  ["acpTable", "acp"]
]);

it("shares built ordinary service references; hooks stay distinct across the isolated events pack", async () => {
  const dist = fileURLToPath(new URL("../dist/", import.meta.url));
  const { builtinProviders } = (await import(pathToFileURL(resolve(dist, "providers.js")).href)) as {
    builtinProviders: readonly Provider[];
  };
  const seen = new Set<string>();
  const covered = new Set<OrdinaryService>();
  const queue = ["discovery", "harness", "sessions", "transcript", "acp", "testing"].map((entry) =>
    resolve(dist, `${entry}.js`)
  );
  // Follow emitted imports rather than chunk filenames: a separate providers pack must fail reference equality.
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);
    const parsed = parseSync(file, readFileSync(file, "utf8"));
    expect(parsed.errors).toEqual([]);
    for (const node of parsed.program.body) {
      if (node.type !== "ImportDeclaration" || !node.source.value.startsWith(".")) {
        continue;
      }
      const target = resolve(dirname(file), node.source.value);
      queue.push(target);
      for (const specifier of node.specifiers) {
        const service = services.get(specifier.local.name);
        if (specifier.type !== "ImportSpecifier" || service === undefined) {
          continue;
        }
        const name = specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value;
        const chunk = (await import(pathToFileURL(target).href)) as Record<
          string,
          () => Readonly<Partial<Record<string, unknown>>>
        >;
        const table = chunk[name]!();
        covered.add(service);
        for (const provider of builtinProviders) {
          expect(table[provider.id], `${service}/${provider.id}`).toBe(provider[service]);
        }
      }
    }
  }
  expect([...covered].sort()).toEqual([...services.values()].sort());
});
