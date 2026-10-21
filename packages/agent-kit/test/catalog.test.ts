import { describe, expect, it } from "vite-plus/test";

import { isBuiltinCodingAgentId } from "../src/catalog.js";
import { builtinProviders } from "../src/providers.js";
import { homeRuleOf, homeFromRule, parseCodingAgentId } from "@rivus/agent-kit-catalog/public";

const builtinCodingAgents = Object.fromEntries(
  builtinProviders.flatMap(({ id, identity }) => (identity ? [[id, identity]] : []))
);

const home = "/u/me";

/** Every built-in identity with a verified home, sorted. */
const HOMED = ["claude-code", "codex", "gemini-cli", "grok", "opencode", "pi"];

describe("built-in home rules", () => {
  it.each([
    ["claude-code", "/u/me/.claude"],
    ["codex", "/u/me/.codex"],
    ["gemini-cli", "/u/me/.gemini"],
    ["grok", "/u/me/.grok"],
    ["opencode", "/u/me/.local/share/opencode"],
    ["pi", "/u/me/.pi/agent"]
  ] as const)("defaults %s to %s", (id, path) => {
    expect(homeFromRule(id, builtinCodingAgents[id]!.home!, { env: {}, home })).toEqual({
      agent: id,
      path,
      source: { kind: "default" }
    });
  });

  it.each([
    ["claude-code", "CLAUDE_CONFIG_DIR", "/cfg/claude", "/cfg/claude"],
    ["codex", "CODEX_HOME", "/cfg/codex", "/cfg/codex"],
    ["gemini-cli", "GEMINI_CLI_HOME", "/alt", "/alt/.gemini"],
    ["grok", "GROK_HOME", "/cfg/grok", "/cfg/grok"],
    ["opencode", "XDG_DATA_HOME", "/data", "/data/opencode"],
    ["pi", "PI_CODING_AGENT_DIR", "/cfg/pi", "/cfg/pi"]
  ] as const)("lets %s's %s override the default", (id, variable, value, path) => {
    expect(homeFromRule(id, builtinCodingAgents[id]!.home!, { env: { [variable]: value }, home })).toEqual({
      agent: id,
      path,
      source: { kind: "env", variable }
    });
  });

  it("treats a blank override as unset and drops a trailing slash", () => {
    expect(homeFromRule("codex", builtinCodingAgents["codex"]!.home!, { env: { CODEX_HOME: "  " }, home }).path).toBe(
      "/u/me/.codex"
    );
    expect(
      homeFromRule("codex", builtinCodingAgents["codex"]!.home!, { env: { CODEX_HOME: " /cfg/codex/ " }, home }).path
    ).toBe("/cfg/codex");
    expect(homeFromRule("claude-code", builtinCodingAgents["claude-code"]!.home!, { env: {}, home: "/" }).path).toBe(
      "/.claude"
    );
  });

  it("keeps the separator of a root, so a drive root does not become drive-relative", () => {
    expect(homeFromRule("codex", builtinCodingAgents["codex"]!.home!, { env: { CODEX_HOME: "C:\\" }, home }).path).toBe(
      "C:\\"
    );
    expect(homeFromRule("claude-code", builtinCodingAgents["claude-code"]!.home!, { env: {}, home: "C:\\" }).path).toBe(
      "C:\\.claude"
    );
    expect(
      homeFromRule("claude-code", builtinCodingAgents["claude-code"]!.home!, { env: {}, home: "C:\\Users\\me\\" }).path
    ).toBe("C:\\Users\\me/.claude");
    expect(homeFromRule("codex", builtinCodingAgents["codex"]!.home!, { env: { CODEX_HOME: "//" }, home }).path).toBe(
      "/"
    );
  });

  it("expands a leading ~ only for an agent that does so itself", () => {
    expect(
      homeFromRule("pi", builtinCodingAgents["pi"]!.home!, { env: { PI_CODING_AGENT_DIR: "~/pi-agent" }, home }).path
    ).toBe("/u/me/pi-agent");
    expect(homeFromRule("pi", builtinCodingAgents["pi"]!.home!, { env: { PI_CODING_AGENT_DIR: "~" }, home }).path).toBe(
      "/u/me"
    );
    expect(
      homeFromRule("pi", builtinCodingAgents["pi"]!.home!, { env: { PI_CODING_AGENT_DIR: "~other/x" }, home }).path
    ).toBe("~other/x");
    expect(
      homeFromRule("codex", builtinCodingAgents["codex"]!.home!, { env: { CODEX_HOME: "~/codex" }, home }).path
    ).toBe("~/codex");
  });

  it("has an identity for every built-in id", () => {
    for (const [id, agent] of Object.entries(builtinCodingAgents)) {
      expect(agent.id).toBe(id);
      expect(isBuiltinCodingAgentId(id)).toBe(true);
    }
    expect(isBuiltinCodingAgentId("toString")).toBe(false);
  });

  it("has a home rule exactly for the verified agents", () => {
    const withHome = Object.values(builtinCodingAgents).filter((agent) => agent.home !== undefined);
    expect(withHome.map((agent) => agent.id).toSorted()).toEqual(HOMED);
    expect(Object.keys(builtinCodingAgents)).toHaveLength(7);
  });
});

describe("homeRuleOf", () => {
  it("gives the caller's own rule for the agent precedence, else a built-in agent's, else nothing", () => {
    const own = { envVar: "MY_HOME", defaultPath: [".mine"] };
    expect(homeRuleOf("claude-code", builtinCodingAgents, own)).toBe(own);
    expect(homeRuleOf("claude-code", builtinCodingAgents)).toEqual(builtinCodingAgents["claude-code"]!.home!);
    expect(homeRuleOf("my-agent", builtinCodingAgents)).toBeUndefined();
    expect(homeRuleOf("my-agent", builtinCodingAgents, own)).toBe(own);
  });
});

describe("parseCodingAgentId", () => {
  it("maps aliases and spelling variants to the canonical id", () => {
    expect(parseCodingAgentId("claude", builtinCodingAgents)).toEqual({ ok: true, value: "claude-code" });
    expect(parseCodingAgentId(" Gemini ", builtinCodingAgents)).toEqual({ ok: true, value: "gemini-cli" });
    expect(parseCodingAgentId("codex", builtinCodingAgents)).toEqual({ ok: true, value: "codex" });
  });

  it("maps the command names of agents that discovery added", () => {
    expect(parseCodingAgentId("cursor-agent", builtinCodingAgents)).toEqual({ ok: true, value: "cursor" });
  });

  it("gives every id and alias to one agent only", () => {
    const names = Object.values(builtinCodingAgents).flatMap((agent) => [agent.id, ...agent.aliases]);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it("accepts a third-party id of the right shape and rejects anything else", () => {
    expect(parseCodingAgentId("my-agent", builtinCodingAgents)).toEqual({ ok: true, value: "my-agent" });
    for (const input of ["", "my agent", "-x", "x-", "a/b"]) {
      expect(parseCodingAgentId(input, builtinCodingAgents)).toEqual({
        ok: false,
        error: { _tag: "InvalidCodingAgentId", input }
      });
    }
  });
});
