import { describe, expect, it } from "vitest";

import { builtinCodingAgents, isBuiltinCodingAgentId, parseCodingAgentId, resolveHome } from "./index.js";

const home = "/u/me";

describe("resolveHome", () => {
  it.each([
    ["claude-code", "/u/me/.claude"],
    ["codex", "/u/me/.codex"],
    ["cursor", "/u/me/.cursor"],
    ["gemini-cli", "/u/me/.gemini"],
    ["grok", "/u/me/.grok"],
    ["opencode", "/u/me/.local/share/opencode"],
    ["pi", "/u/me/.pi/agent"]
  ] as const)("defaults %s to %s", (id, path) => {
    expect(resolveHome(id, { env: {}, home })).toEqual({ agent: id, path, source: { kind: "default" } });
  });

  it.each([
    ["claude-code", "CLAUDE_CONFIG_DIR", "/cfg/claude", "/cfg/claude"],
    ["codex", "CODEX_HOME", "/cfg/codex", "/cfg/codex"],
    ["gemini-cli", "GEMINI_CLI_HOME", "/alt", "/alt/.gemini"],
    ["grok", "GROK_HOME", "/cfg/grok", "/cfg/grok"],
    ["opencode", "XDG_DATA_HOME", "/data", "/data/opencode"],
    ["pi", "PI_CODING_AGENT_DIR", "/cfg/pi", "/cfg/pi"]
  ] as const)("lets %s's %s override the default", (id, variable, value, path) => {
    expect(resolveHome(id, { env: { [variable]: value }, home })).toEqual({
      agent: id,
      path,
      source: { kind: "env", variable }
    });
  });

  it("treats a blank override as unset and drops a trailing slash", () => {
    expect(resolveHome("codex", { env: { CODEX_HOME: "  " }, home }).path).toBe("/u/me/.codex");
    expect(resolveHome("codex", { env: { CODEX_HOME: " /cfg/codex/ " }, home }).path).toBe("/cfg/codex");
    expect(resolveHome("claude-code", { env: {}, home: "/" }).path).toBe("/.claude");
  });

  it("keeps the separator of a root, so a drive root does not become drive-relative", () => {
    expect(resolveHome("codex", { env: { CODEX_HOME: "C:\\" }, home }).path).toBe("C:\\");
    expect(resolveHome("claude-code", { env: {}, home: "C:\\" }).path).toBe("C:\\.claude");
    expect(resolveHome("claude-code", { env: {}, home: "C:\\Users\\me\\" }).path).toBe("C:\\Users\\me/.claude");
    expect(resolveHome("codex", { env: { CODEX_HOME: "//" }, home }).path).toBe("/");
  });

  it("expands a leading ~ only for an agent that does so itself", () => {
    expect(resolveHome("pi", { env: { PI_CODING_AGENT_DIR: "~/pi-agent" }, home }).path).toBe("/u/me/pi-agent");
    expect(resolveHome("pi", { env: { PI_CODING_AGENT_DIR: "~" }, home }).path).toBe("/u/me");
    expect(resolveHome("pi", { env: { PI_CODING_AGENT_DIR: "~other/x" }, home }).path).toBe("~other/x");
    expect(resolveHome("codex", { env: { CODEX_HOME: "~/codex" }, home }).path).toBe("~/codex");
  });

  it("has an identity for every built-in id", () => {
    for (const [id, agent] of Object.entries(builtinCodingAgents)) {
      expect(agent.id).toBe(id);
      expect(isBuiltinCodingAgentId(id)).toBe(true);
    }
    expect(isBuiltinCodingAgentId("toString")).toBe(false);
  });
});

describe("parseCodingAgentId", () => {
  it("maps aliases and spelling variants to the canonical id", () => {
    expect(parseCodingAgentId("claude")).toEqual({ ok: true, value: "claude-code" });
    expect(parseCodingAgentId(" Gemini ")).toEqual({ ok: true, value: "gemini-cli" });
    expect(parseCodingAgentId("codex")).toEqual({ ok: true, value: "codex" });
  });

  it("accepts a third-party id of the right shape and rejects anything else", () => {
    expect(parseCodingAgentId("my-agent")).toEqual({ ok: true, value: "my-agent" });
    for (const input of ["", "my agent", "-x", "x-", "a/b"]) {
      expect(parseCodingAgentId(input)).toEqual({ ok: false, error: { _tag: "InvalidCodingAgentId", input } });
    }
  });
});
