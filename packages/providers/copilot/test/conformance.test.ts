import { describe, expect, it } from "vite-plus/test";
import { hookDialectConformance, probeRecipeConformance } from "@rivus/agent-kit-testing/public";
import { copilotProbe } from "../src/discovery.js";
import { copilotHookDialect } from "../src/hooks.js";
import { copilot } from "../src/identity.js";
import { copilotInstallAdapter } from "../src/install.js";
import { copilotSamples } from "./fixtures/hooks.js";

const ok = (stdout: string, stderr = "") => ({ code: 0, stdout, stderr });
const samples = {
  versions: [
    {
      output: ok("GitHub Copilot CLI 1.0.114.\nRun 'copilot update' to check for updates.\n"),
      version: {
        output: "GitHub Copilot CLI 1.0.114.\nRun 'copilot update' to check for updates.",
        number: "1.0.114"
      }
    }
  ]
};

for (const [service, checks] of [
  ["hooks", hookDialectConformance(copilotHookDialect, { samples: copilotSamples }, { copilot: copilotHookDialect })],
  ["discovery", probeRecipeConformance(copilotProbe, samples, { copilot })]
] as const) {
  describe(`copilot ${service} conformance`, () => {
    for (const { name, run } of checks) {
      it(`${name}`, async () => {
        await expect(run()).resolves.toBeUndefined();
      });
    }
  });
}

describe("copilot install adapter", () => {
  it("renders an owned hooks JSON file under ~/.copilot/hooks/<owner>.json and skills under ~/.copilot/skills/<name>", () => {
    const context = { home: "/u/me", env: {} };
    const bundle = { owner: "tools/acme", version: "1.0.0", digest: "sha256:0000" };
    const rendered = copilotInstallAdapter.renderHooks(
      "scan-directory",
      [
        { event: "PreToolUse", command: "acme-hook pre", timeout: 10, agents: ["copilot"] },
        { event: "SessionStart", command: "acme-hook start", agents: ["copilot"] }
      ],
      bundle,
      context
    );
    expect(rendered).toHaveLength(1);
    const artifact = rendered[0]!;
    expect(artifact.locator).toEqual({ kind: "file", path: "/u/me/.copilot/hooks/tools-acme.json" });
    expect(JSON.parse(artifact.content as string)).toEqual({
      version: 1,
      hooks: {
        PreToolUse: [{ type: "command", command: "acme-hook pre", timeout: 10 }],
        SessionStart: [{ type: "command", command: "acme-hook start" }]
      }
    });

    const skills = copilotInstallAdapter.renderSkill(
      "scan-directory",
      { type: "skill", name: "review", files: { "SKILL.md": "# review" } },
      context
    );
    expect(skills[0]?.locator).toEqual({ kind: "dir", path: "/u/me/.copilot/skills/review" });
  });
});
