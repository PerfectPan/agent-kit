import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vite-plus/test";

import { blurbFor, entryBlurbs, missingDeclarationsMessage, publicEntries } from "./api-entries.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

it("keeps package export order and skips package.json", () => {
  const entries = publicEntries("@rivus/agent-kit", {
    "./sessions": { types: "./dist/sessions.d.ts" },
    "./package.json": "./package.json",
    "./harness/events": { types: "./dist/harness/events.d.ts" }
  });
  expect(entries.map((entry) => entry.specifier)).toEqual([
    "@rivus/agent-kit/sessions",
    "@rivus/agent-kit/harness/events"
  ]);
  expect(entries[1]?.slug).toBe("harness-events");
  expect(entries[1]?.typesRelative).toBe("dist/harness/events.d.ts");
});

it("reads one line from each introduction entry row", () => {
  const blurbs = entryBlurbs(`
| [\`@rivus/agent-kit/sessions\`](/docs/connection/sessions) | \`listSessions\`, \`SessionAdapter\` | anywhere, with a platform |
| [\`@rivus/agent-kit-collab/lease\`](/docs/coordination/leases) | \`createLeaseManager\` | Effect |
| not a row |
`);
  expect(blurbFor(blurbs, "@rivus/agent-kit/sessions")).toBe(
    "`listSessions`, `SessionAdapter` — anywhere, with a platform"
  );
  expect(blurbFor(blurbs, "@rivus/agent-kit-collab/lease")).toBe("`createLeaseManager` — Effect");
  expect(() => blurbFor(blurbs, "@rivus/agent-kit/missing")).toThrow(/missing/);
});

it("names the missing declaration files in the build error", () => {
  const message = missingDeclarationsMessage("@rivus/agent-kit", ["packages/agent-kit/dist/sessions.d.ts"]);
  expect(message).toContain("@rivus/agent-kit");
  expect(message).toContain("packages/agent-kit/dist/sessions.d.ts");
  expect(message).toContain("pnpm run build");
});

it("has an introduction line for every published entry", () => {
  const introduction = readFileSync(join(repoRoot, "apps/website/content/docs/en/index.mdx"), "utf8");
  const blurbs = entryBlurbs(introduction);
  for (const packageName of ["@rivus/agent-kit", "@rivus/agent-kit-collab"] as const) {
    const folder = packageName.replace("@rivus/", "");
    const manifest = JSON.parse(readFileSync(join(repoRoot, "packages", folder, "package.json"), "utf8")) as {
      exports: Record<string, string | { types?: string }>;
    };
    for (const entry of publicEntries(packageName, manifest.exports)) {
      expect(blurbFor(blurbs, entry.specifier).length).toBeGreaterThan(0);
    }
  }
});
