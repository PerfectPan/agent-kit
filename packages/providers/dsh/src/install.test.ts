import { describe, expect, it } from "vite-plus/test";

import { dshInstallAdapter as adapter } from "./install.js";

const context = { home: "/u/me", env: { DSH_HOME: "/elsewhere/dsh" } };
const bundle = { owner: "@demo/app", version: "1.0.0", digest: "demo" };

describe("DeepSeek Harness install rendering", () => {
  it("supports shared scan-directory skills and declares no command hook strategies", () => {
    expect(adapter.agent).toBe("dsh");
    expect(adapter.specificationVersion).toBe("harness-v1");
    expect(adapter.hookStrategies).toEqual([]);
    expect(adapter.skillStrategies).toEqual(["scan-directory"]);
    expect(adapter.roots(context)).toEqual(["/u/me/.agents"]);
    expect(adapter.hookFile("shared-config", bundle)).toBe("");
    expect(adapter.hookSources?.(context)).toEqual([]);
    expect(adapter.renderHooks("shared-config", [], bundle, context)).toEqual([]);
  });

  it("renders skills into ~/.agents/skills/<name> by default", () => {
    const skill = {
      type: "skill" as const,
      name: "demo-skill",
      files: { "SKILL.md": "---\nname: demo-skill\n---\nBody\n" }
    };
    const rendered = adapter.renderSkill("scan-directory", skill, context);
    expect(rendered).toEqual([
      {
        locator: { kind: "dir", path: "/u/me/.agents/skills/demo-skill" },
        content: skill.files,
        strategy: "scan-directory"
      }
    ]);
  });

  it("honors DSH_AGENTS_HOME with trimming, tilde expansion, and blank fallback", () => {
    const skill = {
      type: "skill" as const,
      name: "demo-skill",
      files: { "SKILL.md": "---\nname: demo-skill\n---\nBody\n" }
    };

    const custom = { home: "/u/me", env: { DSH_AGENTS_HOME: " /srv/dsh-agents/ " } };
    expect(adapter.roots(custom)).toEqual(["/srv/dsh-agents"]);
    expect(adapter.renderSkill("scan-directory", skill, custom)).toEqual([
      {
        locator: { kind: "dir", path: "/srv/dsh-agents/skills/demo-skill" },
        content: skill.files,
        strategy: "scan-directory"
      }
    ]);

    const tilde = { home: "/u/me", env: { DSH_AGENTS_HOME: "~/custom-agents/" } };
    expect(adapter.roots(tilde)).toEqual(["/u/me/custom-agents"]);
    expect(adapter.renderSkill("scan-directory", skill, tilde)[0]?.locator).toEqual({
      kind: "dir",
      path: "/u/me/custom-agents/skills/demo-skill"
    });

    const blank = { home: "/u/me", env: { DSH_AGENTS_HOME: "   " } };
    expect(adapter.roots(blank)).toEqual(["/u/me/.agents"]);
    expect(adapter.renderSkill("scan-directory", skill, blank)[0]?.locator).toEqual({
      kind: "dir",
      path: "/u/me/.agents/skills/demo-skill"
    });
  });
});
