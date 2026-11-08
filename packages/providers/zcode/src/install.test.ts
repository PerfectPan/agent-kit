import { describe, expect, it } from "vite-plus/test";
import * as z from "zod/mini";
import type { PlacedRegistration } from "@rivus/agent-kit-harness/spi";
import { zcodeInstallAdapter as adapter } from "./install.js";
import { zcodeHookDialect } from "./hooks.js";

const context = { home: "/u/me", env: { ZCODE_STORAGE_DIR: "/elsewhere/storage" } };
const bundle = { owner: "@demo/app", version: "1.2.3", digest: "demo" };
const registrations: readonly PlacedRegistration[] = [
  { event: "SessionStart", command: "first-hook", timeout: 1500, agents: ["zcode"] },
  { event: "SessionStart", command: "second-hook", agents: ["zcode"] },
  { event: "Stop", command: "last-hook", timeout: 5000, agents: ["zcode"] }
];
const filesSchema = z.record(z.string(), z.string());
const manifestSchema = z.object({ name: z.string(), version: z.string() });

function rendered(owner = bundle.owner, version = bundle.version) {
  const artifacts = adapter.renderHooks("native-plugin", registrations, { ...bundle, owner, version }, context);
  const files = filesSchema.parse(artifacts[0]?.content);
  const manifest = manifestSchema.parse(JSON.parse(files[".zcode-plugin/plugin.json"]!));
  return { artifacts, files, manifest };
}

describe("ZCode install rendering", () => {
  it("offers only native-plugin hooks and shared scan-directory skills, without foreign or legacy sources", () => {
    expect(adapter.agent).toBe("zcode");
    expect(adapter.specificationVersion).toBe("harness-v1");
    expect(adapter.hookStrategies).toEqual(["native-plugin"]);
    expect(adapter.skillStrategies).toEqual(["scan-directory"]);
    expect(Object.hasOwn(adapter, "legacySources")).toBe(false);
    expect(zcodeHookDialect.runsHooksOf).toBeUndefined();
    expect(adapter.renderHooks("native-plugin", [], bundle, context)).toEqual([]);
  });

  it("renders grouped hooks with timeoutMs and preserves the engine default when no timeout was requested", () => {
    const { files } = rendered();
    expect(zcodeHookDialect.timeout?.unit).toBe("milliseconds");
    expect(JSON.parse(files["hooks/hooks.json"]!)).toEqual({
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: "first-hook", timeoutMs: 1500 }] },
          { hooks: [{ type: "command", command: "second-hook" }] }
        ],
        Stop: [{ hooks: [{ type: "command", command: "last-hook", timeoutMs: 5000 }] }]
      }
    });
  });

  it("keeps names valid, bounded and stable across upgrades, distinguishing scoped and truncated owner slugs", () => {
    const owners = ["demo-app", "@demo/app", "a".repeat(180), `${"a".repeat(179)}b`];
    const names = owners.map((owner) => {
      const { artifacts, manifest } = rendered(owner);
      expect(manifest.name).toMatch(/^[a-z0-9][a-z0-9._-]{0,127}$/);
      expect(manifest.version).toBe("1.2.3");
      const upgraded = rendered(owner, "2.0.0");
      expect(upgraded.manifest).toEqual({ ...manifest, version: "2.0.0" });
      expect(upgraded.artifacts.map((artifact) => artifact.locator)).toEqual(artifacts.map((a) => a.locator));
      return manifest.name;
    });
    expect(new Set(names).size).toBe(owners.length);
    expect(names[1]).toMatch(/^demo-app-/);
  });

  it.each([
    { seconds: 2.01, milliseconds: 2010 },
    { seconds: 0.0001, milliseconds: 1 }
  ])("renders $seconds seconds as the positive integer timeoutMs $milliseconds", ({ seconds, milliseconds }) => {
    const artifacts = adapter.renderHooks(
      "native-plugin",
      [{ event: "Stop", command: "demo-hook", timeout: seconds * 1000, agents: ["zcode"] }],
      bundle,
      context
    );
    const files = filesSchema.parse(artifacts[0]?.content);
    expect(JSON.parse(files["hooks/hooks.json"]!)).toEqual({
      hooks: { Stop: [{ hooks: [{ type: "command", command: "demo-hook", timeoutMs: milliseconds }] }] }
    });
  });

  it("registers one absolute plugin path under owned roots, independent of the storage override", () => {
    const { artifacts, manifest } = rendered();
    const dir = `/u/me/.agents/agent-kit/zcode/${manifest.name}`;
    expect(artifacts[0]?.locator).toEqual({ kind: "dir", path: dir });
    expect(artifacts[1]).toEqual({
      locator: {
        kind: "json-entry",
        path: "/u/me/.zcode/cli/config.json",
        pointer: "/plugins/dirs",
        member: dir,
        memberIn: "element"
      },
      content: dir,
      strategy: "native-plugin",
      agents: ["zcode"]
    });
    expect(adapter.roots(context)).toEqual(["/u/me/.zcode", "/u/me/.agents"]);
    for (const artifact of artifacts) {
      expect(adapter.roots(context).some((root) => artifact.locator.path.startsWith(`${root}/`))).toBe(true);
    }
    expect(adapter.renderHooks("native-plugin", registrations, bundle, { ...context, env: {} })).toEqual(artifacts);
    expect(adapter.hookFile("native-plugin", bundle)).toBe(
      `~/.agents/agent-kit/zcode/${manifest.name}/hooks/hooks.json`
    );
  });

  it("scans kit plugin hooks for doctor and installs skills in the shared directory", () => {
    expect(adapter.hookSources?.(context)).toEqual([
      { path: "/u/me/.agents/agent-kit/zcode/*/hooks/hooks.json", format: "json", layout: "grouped" }
    ]);
    const files = { "SKILL.md": "---\nname: demo\ndescription: Demo\n---\nDemo\n" };
    expect(adapter.renderSkill("scan-directory", { type: "skill", name: "demo", files }, context)).toEqual([
      { locator: { kind: "dir", path: "/u/me/.agents/skills/demo" }, content: files, strategy: "scan-directory" }
    ]);
  });
});
