import { describe, expect, it } from "vite-plus/test";
import { detectAgents } from "@rivus/agent-kit-discovery/public";
import { createMemoryPlatform, probeRecipeConformance } from "@rivus/agent-kit-testing/public";
import { dsh } from "../src/identity.js";
import { dshProbe } from "../src/discovery.js";

const ok = (stdout: string, stderr = "") => ({ code: 0, stdout, stderr });

// The output of `dsh --version` on the verified install.
const samples = {
  versions: [{ output: ok("0.2.1-rc.3\n"), version: { output: "0.2.1-rc.3", number: "0.2.1-rc.3" } }]
};

describe("dsh discovery conformance", () => {
  for (const { name, run } of probeRecipeConformance(dshProbe, samples, { dsh })) {
    it(`${name}`, async () => {
      await expect(run()).resolves.toBeUndefined();
    });
  }
});

describe("dsh discovery evidence", () => {
  const detect = (files: Record<string, string>) =>
    detectAgents(
      createMemoryPlatform({
        home: "/u/me",
        env: { PATH: "/usr/bin" },
        files: Object.fromEntries(Object.entries(files).map(([path, text]) => [path, new TextEncoder().encode(text)]))
      }),
      { versionProbe: false, providers: { discovery: { dsh: dshProbe }, identity: { dsh } } }
    );

  it("counts neither the home nor a skill another installer put under it", async () => {
    const [installation] = await detect({ "/u/me/.dsh/skills/example/SKILL.md": "---\nname: example\n---\n" });
    expect(installation).toMatchObject({ agent: "dsh", status: "missing", evidence: [] });
  });

  it("counts the session store", async () => {
    const [installation] = await detect({ "/u/me/.dsh/sessions/-u-me-work-/s1/session.v4.jsonl": "{}\n" });
    expect(installation).toMatchObject({
      agent: "dsh",
      status: "found",
      evidence: [{ kind: "config", path: "/u/me/.dsh/sessions" }]
    });
  });
});
