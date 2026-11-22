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

  it("renders skills into ~/.agents/skills/<name>", () => {
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
});
