import { expect, it, vi } from "vite-plus/test";

import { codexInstallAdapter } from "../src/install.js";

vi.mock("../src/facts.js", async (original) => ({
  ...(await original<typeof import("../src/facts.js")>()),
  CODEX_PLUGINS_DIR: "plugin-files",
  CODEX_PLUGINS_POINTER: "/registered-plugins"
}));

it("round-trips plugin registration pointers independently of the plugin directory", () => {
  const context = { home: "/virtual/home", env: {} };
  const artifacts = codexInstallAdapter.renderHooks(
    "native-plugin",
    [{ event: "Stop", command: "test-hook", agents: ["codex"] }],
    { owner: "test-app", version: "1", digest: "test" },
    context
  );
  const plugin = artifacts.find(
    ({ locator }) => locator.kind === "cli-registration" && locator.pointer?.startsWith("/registered-plugins/")
  );
  expect(plugin).toBeDefined();
  const registration = codexInstallAdapter.cliRegistration?.(plugin!.locator, context);
  expect(registration).toMatchObject({
    register: { command: "codex", args: ["plugin", "add", "test-app@test-app"] },
    unregister: { command: "codex", args: ["plugin", "remove", "test-app@test-app"] },
    recorded: { entries: [{ kind: "toml-entry", pointer: "/registered-plugins/test-app@test-app" }] }
  });
  expect(artifacts[0]?.locator).toEqual({ kind: "dir", path: "/virtual/home/.codex/plugin-files/test-app" });
  expect(
    codexInstallAdapter.cliRegistration?.(
      { kind: "cli-registration", path: "/virtual/home/.codex/config.toml", pointer: "/plugins/test-app@test-app" },
      context
    )
  ).toBeUndefined();
});
