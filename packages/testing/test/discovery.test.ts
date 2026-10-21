import { builtinProbeRecipes as testDiscovery } from "./providers.js";
import { builtinCodingAgents as testIdentity } from "./providers.js";
import { isAgentKitError } from "@rivus/agent-kit-catalog";
import {
  type DetectAgentsOptions,
  detectAgents,
  type Installation,
  type ProbeRecipe,
  versionFromOutput
} from "@rivus/agent-kit-discovery";
import { builtinProbeRecipes } from "./providers.js";
import type { RunOptions } from "@rivus/agent-kit-platform";
import { describe, expect, it } from "vite-plus/test";

import {
  createMemoryPlatform,
  type MemoryCommand,
  type MemoryPlatform,
  type MemoryPlatformOptions
} from "../src/memory-platform.js";

const HOME = "/u/me";

/** A machine with `/opt/bin` on `PATH` and an existing home directory. */
function machine(options: MemoryPlatformOptions = {}): MemoryPlatform {
  return createMemoryPlatform({
    home: HOME,
    ...options,
    env: { PATH: "/opt/bin", ...options.env },
    files: { [`${HOME}/.profile`]: "", ...options.files }
  });
}

async function detectOne(
  platform: MemoryPlatform,
  agent: string,
  options: Omit<DetectAgentsOptions, "agents" | "providers"> = {}
): Promise<Installation> {
  const [installation] = await detectAgents(platform, {
    ...options,
    agents: [agent],
    providers: { discovery: testDiscovery, identity: testIdentity }
  });
  if (installation === undefined) {
    throw new Error(`no installation for ${agent}`);
  }
  return installation;
}

/** A program that answers `--version` with `version` and the other arguments from `rest`. */
function program(version: string, rest: Record<string, MemoryCommand> = {}): MemoryCommand {
  return (args, options) => {
    if (args.join(" ") === "--version") {
      return { stdout: `${version}\n` };
    }
    const answer = rest[args.join(" ")];
    if (answer === undefined) {
      return { code: 2, stderr: "unexpected arguments" };
    }
    return typeof answer === "function" ? answer(args, options) : answer;
  };
}

describe("detectAgents", () => {
  it("S36: reports a command with a working version probe as runnable and an agent's session store as found", async () => {
    const platform = machine({
      files: { [`${HOME}/.gemini/tmp/project/chats/session.json`]: "{}" },
      commands: { "/opt/bin/codex": program("codex-cli 0.154.0") }
    });
    const [codex, gemini] = await detectAgents(platform, {
      agents: ["codex", "gemini-cli"],
      providers: { discovery: testDiscovery, identity: testIdentity }
    });
    expect(codex).toMatchObject({
      agent: "codex",
      displayName: "Codex",
      kind: "cli",
      status: "runnable",
      command: "/opt/bin/codex",
      version: { output: "codex-cli 0.154.0", number: "0.154.0" },
      evidence: [
        { kind: "command", command: "codex", path: "/opt/bin/codex" },
        {
          kind: "version",
          path: "/opt/bin/codex",
          args: ["--version"],
          version: { output: "codex-cli 0.154.0", number: "0.154.0" }
        }
      ]
    });
    expect(gemini).toEqual({
      agent: "gemini-cli",
      displayName: "Gemini CLI",
      kind: "cli",
      status: "found",
      auth: { status: "unknown" },
      evidence: [{ kind: "config", path: `${HOME}/.gemini/tmp` }],
      problems: [],
      warnings: []
    });
  });

  it("reports every built-in agent in table order, all missing on an empty machine", async () => {
    const installations = await detectAgents(machine(), {
      providers: { discovery: testDiscovery, identity: testIdentity }
    });
    expect(installations.map((installation) => installation.agent)).toEqual(Object.keys(builtinProbeRecipes));
    expect(new Set(installations.map((installation) => installation.status))).toEqual(new Set(["missing"]));
  });

  it("checks agent-home paths under the agent's override variable", async () => {
    const platform = machine({
      env: { CODEX_HOME: "/cfg/codex", CLAUDE_CONFIG_DIR: "/cfg/claude" },
      files: {
        [`${HOME}/.codex/sessions/session.jsonl`]: "",
        "/cfg/codex/sessions/session.jsonl": "",
        "/cfg/claude/projects/project/session.jsonl": ""
      }
    });
    const [codex, claude] = await detectAgents(platform, {
      agents: ["codex", "claude"],
      providers: { discovery: testDiscovery, identity: testIdentity }
    });
    expect(codex?.evidence).toEqual([{ kind: "config", path: "/cfg/codex/sessions" }]);
    expect(claude?.evidence).toEqual([{ kind: "config", path: "/cfg/claude/projects" }]);
  });

  it("accepts aliases once each and throws capability-unsupported for an agent without a recipe", async () => {
    const installations = await detectAgents(machine(), {
      agents: ["claude", "claude-code", "cursor-agent"],
      providers: { discovery: testDiscovery, identity: testIdentity }
    });
    expect(installations.map((installation) => installation.agent)).toEqual(["claude-code", "cursor"]);
    const error: unknown = await detectAgents(machine(), {
      agents: ["my-agent"],
      providers: { discovery: testDiscovery, identity: testIdentity }
    }).catch((caught: unknown) => caught);
    expect(isAgentKitError(error)).toBe(true);
    expect(error).toMatchObject({ code: "capability-unsupported" });
  });

  it("S53: keeps a command whose version probe times out, cannot start or prints nothing found, with the problem", async () => {
    const platform = machine({
      files: { "/opt/bin/claude": "" },
      commands: {
        "/opt/bin/codex": () => new Promise(() => undefined),
        "/opt/bin/gemini": { stdout: "  \n" }
      }
    });
    const [codex, claude, gemini] = await detectAgents(platform, {
      agents: ["codex", "claude-code", "gemini-cli"],
      timeoutMs: 20,
      providers: { discovery: testDiscovery, identity: testIdentity }
    });
    const base = { _tag: "CommandFailed", purpose: "version", args: ["--version"] };
    expect(codex).toMatchObject({ status: "found", command: "/opt/bin/codex" });
    expect(codex?.problems).toEqual([{ ...base, path: "/opt/bin/codex", reason: "timed-out" }]);
    expect(claude?.status).toBe("found");
    expect(claude?.problems).toEqual([
      { ...base, path: "/opt/bin/claude", reason: "start-failed", message: "EACCES: /opt/bin/claude" }
    ]);
    expect(gemini?.status).toBe("found");
    expect(gemini?.problems).toEqual([{ ...base, path: "/opt/bin/gemini", reason: "unrecognized", exitCode: 0 }]);
    expect(gemini?.version).toBeUndefined();
  });

  it("S53: reports unknown when nothing is found and a path could not be checked", async () => {
    const base = machine();
    const platform: MemoryPlatform = {
      ...base,
      fs: {
        ...base.fs,
        stat: async (path, options) => {
          if (path === `${HOME}/.grok/sessions`) {
            throw Object.assign(new Error(`EACCES: ${path}`), { code: "EACCES" });
          }
          return base.fs.stat(path, options);
        }
      }
    };
    const installation = await detectOne(platform, "grok");
    expect(installation.status).toBe("unknown");
    expect(installation.problems).toEqual([{ _tag: "StatFailed", path: `${HOME}/.grok/sessions`, code: "EACCES" }]);
  });

  it("rejects when stat fails without an errno code, which is a defect", async () => {
    const base = machine();
    const platform: MemoryPlatform = {
      ...base,
      fs: {
        ...base.fs,
        stat: async () => {
          throw new TypeError("broken platform");
        }
      }
    };
    await expect(detectOne(platform, "codex")).rejects.toThrow("broken platform");
  });

  it("S55: looks commands up in absolute PATH directories, in order, and only as files", async () => {
    const platform = machine({
      env: { PATH: ["bin", "", "/opt/dir", "/opt/b/", "/opt/c"].join(":") },
      files: { "/opt/dir/codex/inner": "", "/u/me/bin/codex": "" },
      commands: { "/opt/b/codex": program("codex-cli 1.0.0"), "/opt/c/codex": program("codex-cli 2.0.0") }
    });
    const installation = await detectOne(platform, "codex");
    expect(installation.command).toBe("/opt/b/codex");
    expect(installation.version?.number).toBe("1.0.0");
  });

  it("finds Windows commands under any spelling of Path with the default PATHEXT", async () => {
    const platform = createMemoryPlatform({
      os: "win32",
      home: "C:\\Users\\me",
      env: { Path: "C:\\tools\\" },
      files: { "C:\\tools\\claude.EXE": "", "C:\\Users\\me\\.keep": "" }
    });
    const installation = await detectOne(platform, "claude-code");
    expect(installation.command).toBe("C:\\tools\\claude.EXE");
  });

  it("S55: runs probes without a shell, in the home directory, with the platform environment", async () => {
    const runs: { args: readonly string[]; options: RunOptions }[] = [];
    const record: MemoryCommand = (args, options) => {
      runs.push({ args, options });
      return args[0] === "--version" ? { stdout: "codex-cli 0.154.0" } : { stderr: "Not logged in", code: 1 };
    };
    const platform = machine({ env: { CODEX_HOME: "/cfg/codex" }, commands: { "/opt/bin/codex": record } });
    await detectOne(platform, "codex", { timeoutMs: 1_234, authProbe: "commands" });
    expect(runs.map((run) => run.args)).toEqual([["--version"], ["login", "status"]]);
    for (const { options } of runs) {
      expect(options).toMatchObject({ cwd: HOME, timeoutMs: 1_234, env: platform.env });
    }
  });

  it("aborting rejects with the signal's reason", async () => {
    const platform = machine({ commands: { "/opt/bin/codex": () => new Promise(() => undefined) } });
    const controller = new AbortController();
    const detection = detectAgents(platform, {
      agents: ["codex"],
      signal: controller.signal,
      providers: { discovery: testDiscovery, identity: testIdentity }
    });
    setTimeout(() => controller.abort(new Error("stop")), 10);
    await expect(detection).rejects.toThrow("stop");
    const aborted = AbortSignal.abort(new Error("early"));
    await expect(
      detectAgents(platform, { signal: aborted, providers: { discovery: testDiscovery, identity: testIdentity } })
    ).rejects.toThrow("early");
  });
});

describe("login state", () => {
  const commands = { authProbe: "commands" } as const;
  const claudeStatus = (json: object, code: number): MemoryCommand => ({ code, stdout: JSON.stringify(json) });

  it("S56: reads only credential files and variables by default, and runs status commands only when asked", async () => {
    const calls: string[] = [];
    const codex = program("codex-cli 0.154.0", {
      "login status": (args) => {
        calls.push(args.join(" "));
        return { code: 1, stderr: "Not logged in\n" };
      }
    });
    const platform = machine({
      files: { [`${HOME}/.codex/auth.json`]: JSON.stringify({ auth_mode: "chatgpt", tokens: { id_token: "secret" } }) },
      commands: { "/opt/bin/codex": codex }
    });
    const byFile = await detectOne(platform, "codex");
    expect(calls).toEqual([]);
    expect(byFile.auth).toEqual({
      status: "logged-in",
      method: "chatgpt",
      source: { kind: "credential-file", path: `${HOME}/.codex/auth.json` }
    });
    expect(JSON.stringify(byFile)).not.toContain("secret");
    const byCommand = await detectOne(platform, "codex", commands);
    expect(calls).toEqual(["login status"]);
    expect(byCommand.auth).toEqual({
      status: "logged-out",
      source: { kind: "command", command: "/opt/bin/codex", args: ["login", "status"] }
    });
  });

  it("S56: runs no login command of any built-in agent by default, and each one when asked", async () => {
    const calls = new Set<string>();
    const recorder: MemoryCommand = (args) => {
      calls.add(args.join(" "));
      return args[0] === "--version" ? { stdout: "tool 1.0.0" } : { code: 1 };
    };
    const names = Object.values(builtinProbeRecipes).flatMap((recipe) => recipe.commands);
    const everything = () =>
      machine({ commands: Object.fromEntries(names.map((name) => [`/opt/bin/${name}`, recorder])) });
    await detectAgents(everything(), { providers: { discovery: testDiscovery, identity: testIdentity } });
    expect([...calls]).toEqual(["--version"]);
    calls.clear();
    await detectAgents(everything(), { ...commands, providers: { discovery: testDiscovery, identity: testIdentity } });
    expect([...calls].toSorted()).toEqual(["--version", "auth status --json", "login status", "status --format json"]);
  });

  it("runs nothing with version probes off, so no agent is runnable", async () => {
    const calls: string[] = [];
    const recorder: MemoryCommand = (args) => {
      calls.push(args.join(" "));
      return { stdout: "tool 1.0.0" };
    };
    const names = Object.values(builtinProbeRecipes).flatMap((recipe) => recipe.commands);
    const platform = machine({ commands: Object.fromEntries(names.map((name) => [`/opt/bin/${name}`, recorder])) });
    const installations = await detectAgents(platform, {
      versionProbe: false,
      providers: { discovery: testDiscovery, identity: testIdentity }
    });
    expect(calls).toEqual([]);
    // Every built-in command resolves, so every agent is found by its command alone; the empty machine that leaves
    // every agent missing is covered above.
    expect(installations.filter((installation) => installation.command !== undefined).length).toBe(
      Object.keys(builtinProbeRecipes).length
    );
    expect(new Set(installations.map((installation) => installation.status))).toEqual(new Set(["found"]));
    expect(installations.every((installation) => installation.version === undefined)).toBe(true);
    await detectAgents(platform, { providers: { discovery: testDiscovery, identity: testIdentity } });
    expect(calls.length).toBeGreaterThan(0);
  });

  it("counts a claude.ai account in ~/.claude.json as logged in without returning it", async () => {
    const platform = machine({
      files: {
        [`${HOME}/.claude.json`]: JSON.stringify({ oauthAccount: { emailAddress: "someone@example.invalid" } })
      },
      commands: { "/opt/bin/claude": program("2.1.286 (Claude Code)") }
    });
    const installation = await detectOne(platform, "claude-code");
    expect(installation.auth).toEqual({
      status: "logged-in",
      method: "claude.ai",
      source: { kind: "credential-file", path: `${HOME}/.claude.json` }
    });
    expect(JSON.stringify(installation)).not.toContain("example.invalid");
  });

  it("reads Claude Code's auth status and keeps only the login method", async () => {
    const loggedIn = machine({
      commands: {
        "/opt/bin/claude": program("2.1.286 (Claude Code)", {
          "auth status --json": claudeStatus(
            { loggedIn: true, authMethod: "claude.ai", email: "someone@example.invalid" },
            0
          )
        })
      }
    });
    const installation = await detectOne(loggedIn, "claude-code", commands);
    expect(installation.auth).toEqual({
      status: "logged-in",
      method: "claude.ai",
      source: { kind: "command", command: "/opt/bin/claude", args: ["auth", "status", "--json"] }
    });
    expect(JSON.stringify(installation)).not.toContain("example.invalid");
    const loggedOut = machine({
      commands: {
        "/opt/bin/claude": program("2.1.286 (Claude Code)", {
          "auth status --json": claudeStatus({ loggedIn: false, authMethod: "none" }, 1)
        })
      }
    });
    expect((await detectOne(loggedOut, "claude-code", commands)).auth).toMatchObject({ status: "logged-out" });
  });

  it("reads Codex's login status from standard error", async () => {
    const platform = machine({
      commands: {
        "/opt/bin/codex": program("codex-cli 0.154.0", { "login status": { stderr: "Logged in using ChatGPT\n" } })
      }
    });
    expect((await detectOne(platform, "codex", commands)).auth).toMatchObject({
      status: "logged-in",
      method: "chatgpt"
    });
  });

  it("S54: reports logged-out only from the status command, and unknown without one", async () => {
    const platform = machine({
      files: { [`${HOME}/.gemini/tmp/project/chats/session.json`]: "{}" },
      commands: {
        "/opt/bin/codex": program("codex-cli 0.154.0", { "login status": { code: 1, stderr: "Not logged in\n" } })
      }
    });
    const [codex, gemini] = await detectAgents(platform, {
      agents: ["codex", "gemini-cli"],
      ...commands,
      providers: { discovery: testDiscovery, identity: testIdentity }
    });
    expect(codex?.auth).toEqual({
      status: "logged-out",
      source: { kind: "command", command: "/opt/bin/codex", args: ["login", "status"] }
    });
    expect(gemini).toMatchObject({ status: "found", auth: { status: "unknown" } });
  });

  it("does not ask a command whose version probe failed, and reports an unreadable answer as a problem", async () => {
    const calls: string[] = [];
    const broken: MemoryCommand = (args) => {
      calls.push(args.join(" "));
      return { code: 1, stderr: "crashed" };
    };
    const found = await detectOne(machine({ commands: { "/opt/bin/codex": broken } }), "codex", commands);
    expect(calls).toEqual(["--version"]);
    expect(found.auth).toEqual({ status: "unknown" });

    const odd = machine({ commands: { "/opt/bin/codex": program("codex-cli 0.154.0", { "login status": {} }) } });
    const installation = await detectOne(odd, "codex", commands);
    expect(installation.auth).toEqual({ status: "unknown" });
    expect(installation.problems).toEqual([
      {
        _tag: "CommandFailed",
        purpose: "auth",
        path: "/opt/bin/codex",
        args: ["login", "status"],
        reason: "unrecognized",
        exitCode: 0
      }
    ]);
  });

  it("counts Gemini CLI's OAuth credential file under its home, or its API key variable, as logged in", async () => {
    const platform = machine({
      env: { GEMINI_CLI_HOME: "/alt", GEMINI_API_KEY: "k" },
      files: { "/alt/.gemini/oauth_creds.json": "{}" },
      commands: { "/opt/bin/gemini": program("0.9.0") }
    });
    expect((await detectOne(platform, "gemini-cli")).auth).toEqual({
      status: "logged-in",
      source: { kind: "credential-file", path: "/alt/.gemini/oauth_creds.json" }
    });
    const keyOnly = machine({ env: { GEMINI_API_KEY: "k" }, commands: { "/opt/bin/gemini": program("0.9.0") } });
    expect((await detectOne(keyOnly, "gemini-cli")).auth).toEqual({
      status: "logged-in",
      method: "api-key",
      source: { kind: "env", variable: "GEMINI_API_KEY" }
    });
  });

  it("counts stored opencode credentials, and an empty auth.json as unknown", async () => {
    const withEntries = (auth: object) =>
      machine({
        env: { XDG_DATA_HOME: "/data" },
        files: { "/data/opencode/auth.json": JSON.stringify(auth) },
        commands: { "/opt/bin/opencode": program("1.18.4") }
      });
    const stored = await detectOne(
      withEntries({ anthropic: { type: "oauth", refresh: "r", access: "a" } }),
      "opencode"
    );
    expect(stored.auth).toEqual({
      status: "logged-in",
      source: { kind: "credential-file", path: "/data/opencode/auth.json" }
    });
    expect((await detectOne(withEntries({}), "opencode")).auth).toEqual({ status: "unknown" });
  });

  it("reports a credential file it cannot read or recognize as a problem, without its content", async () => {
    const platform = machine({
      files: { [`${HOME}/.grok/auth.json`]: "not json: secret" },
      commands: { "/opt/bin/grok": program("grok 1.0.46") }
    });
    const installation = await detectOne(platform, "grok");
    expect(installation.auth).toEqual({ status: "unknown" });
    expect(installation.problems).toEqual([
      { _tag: "CredentialFileFailed", path: `${HOME}/.grok/auth.json`, reason: "unrecognized" }
    ]);
    const large = machine({
      files: { [`${HOME}/.grok/auth.json`]: `{"a":"${"x".repeat(8 * 1024 * 1024)}"}` },
      commands: { "/opt/bin/grok": program("grok 1.0.46") }
    });
    expect((await detectOne(large, "grok")).problems).toEqual([
      { _tag: "CredentialFileFailed", path: `${HOME}/.grok/auth.json`, reason: "too-large" }
    ]);
  });

  it("counts a credential file or an authenticating variable as logged in, and their absence as unknown", async () => {
    const recipe: ProbeRecipe = {
      specificationVersion: "discovery-v1",
      agent: "my-agent",
      displayName: "My Agent",
      kind: "cli",
      commands: ["my-agent"],
      appPaths: [],
      configPaths: [{ agentHome: "my-agent" }],
      mcpConfigPaths: [],
      version: { args: ["--version"], parse: versionFromOutput, sideEffects: [] },
      auth: {
        credentialFiles: [{ path: { agentHome: "my-agent", path: "credentials.json" } }],
        env: [{ name: "MY_AGENT_KEY", method: "api-key" }]
      },
      warnings: [],
      home: { envVar: "MY_AGENT_HOME", defaultPath: [".my-agent"] }
    };
    const detect = async (platform: MemoryPlatform) =>
      (await detectAgents(platform, { providers: { discovery: { "my-agent": recipe }, identity: testIdentity } }))[0]
        ?.auth;
    const withFile = machine({ files: { [`${HOME}/.my-agent/credentials.json`]: "{}" }, env: { MY_AGENT_KEY: "x" } });
    expect(await detect(withFile)).toEqual({
      status: "logged-in",
      source: { kind: "credential-file", path: `${HOME}/.my-agent/credentials.json` }
    });
    const withVariable = machine({ files: { [`${HOME}/.my-agent/config`]: "" }, env: { MY_AGENT_KEY: "x" } });
    expect(await detect(withVariable)).toEqual({
      status: "logged-in",
      method: "api-key",
      source: { kind: "env", variable: "MY_AGENT_KEY" }
    });
    const blank = machine({ files: { [`${HOME}/.my-agent/config`]: "" }, env: { MY_AGENT_KEY: " " } });
    expect(await detect(blank)).toEqual({ status: "unknown" });
  });

  it("throws capability-unsupported for a recipe that checks the home of an agent without a home rule", async () => {
    const recipe: ProbeRecipe = {
      ...builtinProbeRecipes.cursor,
      configPaths: [{ agentHome: "cursor", path: "cli-config.json" }]
    };
    await expect(
      detectAgents(machine(), { providers: { discovery: { cursor: recipe }, identity: testIdentity } })
    ).rejects.toMatchObject({
      code: "capability-unsupported"
    });
  });
});

describe("detectAgents edge cases", () => {
  it("does not run a Windows .cmd shim: the agent is found, with a shell-shim-not-run problem and a warning", async () => {
    const calls: string[] = [];
    const platform = createMemoryPlatform({
      os: "win32",
      home: "C:\\Users\\me",
      env: { Path: "C:\\npm" },
      files: { "C:\\Users\\me\\.keep": "" },
      commands: {
        "C:\\npm\\claude.CMD": (args) => {
          calls.push(args.join(" "));
          return { stdout: "2.1.286 (Claude Code)" };
        }
      }
    });
    const installation = await detectOne(platform, "claude-code", { authProbe: "commands" });
    expect(calls).toEqual([]);
    expect(installation).toMatchObject({ status: "found", command: "C:\\npm\\claude.CMD" });
    expect(installation.problems).toEqual([
      {
        _tag: "CommandFailed",
        purpose: "version",
        path: "C:\\npm\\claude.CMD",
        args: ["--version"],
        reason: "shell-shim-not-run"
      }
    ]);
    expect(installation.warnings.join(" ")).toContain(".cmd or .bat");
  });

  it("drops quotes around Windows PATH entries", async () => {
    const platform = createMemoryPlatform({
      os: "win32",
      home: "C:\\Users\\me",
      env: { PATH: '"C:\\Program Files\\Tools";C:\\other' },
      files: { "C:\\Program Files\\Tools\\grok.EXE": "" }
    });
    expect((await detectOne(platform, "grok", { versionProbe: false })).command).toBe(
      "C:\\Program Files\\Tools\\grok.EXE"
    );
  });

  it("reports unknown, not missing, when a command candidate on PATH could not be checked", async () => {
    const base = machine();
    const platform: MemoryPlatform = {
      ...base,
      fs: {
        ...base.fs,
        stat: async (path, options) => {
          if (path === "/opt/bin/pi") {
            throw Object.assign(new Error(`EACCES: ${path}`), { code: "EACCES" });
          }
          return base.fs.stat(path, options);
        }
      }
    };
    const installation = await detectOne(platform, "pi");
    expect(installation.status).toBe("unknown");
    expect(installation.problems).toEqual([{ _tag: "StatFailed", path: "/opt/bin/pi", code: "EACCES" }]);
  });

  it("treats libuv's UNKNOWN code as a check that could not complete, not as a defect", async () => {
    const base = machine();
    const platform: MemoryPlatform = {
      ...base,
      fs: {
        ...base.fs,
        stat: async (path, options) => {
          if (path === "/opt/bin/pi") {
            throw Object.assign(new Error(`UNKNOWN: ${path}`), { code: "UNKNOWN" });
          }
          return base.fs.stat(path, options);
        }
      }
    };
    const [pi] = await detectAgents(platform, {
      agents: ["pi", "codex"],
      providers: { discovery: testDiscovery, identity: testIdentity }
    });
    expect(pi).toMatchObject({
      status: "unknown",
      problems: [{ _tag: "StatFailed", path: "/opt/bin/pi", code: "UNKNOWN" }]
    });
  });

  it("aborts while a file system call hangs", async () => {
    const base = machine({ files: { [`${HOME}/.grok/auth.json`]: "{}" } });
    const hang = new Promise<never>(() => undefined);
    const hungStat: MemoryPlatform = { ...base, fs: { ...base.fs, stat: () => hang } };
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("stop stat")), 10);
    await expect(
      detectAgents(hungStat, {
        agents: ["codex"],
        signal: controller.signal,
        providers: { discovery: testDiscovery, identity: testIdentity }
      })
    ).rejects.toThrow("stop stat");
    const hungRead: MemoryPlatform = {
      ...base,
      fs: {
        ...base.fs,
        read: (path, range) =>
          path.endsWith("auth.json")
            ? { [Symbol.asyncIterator]: () => ({ next: () => hang }) }
            : base.fs.read(path, range)
      }
    };
    const reading = new AbortController();
    setTimeout(() => reading.abort(new Error("stop read")), 10);
    await expect(
      detectAgents(hungRead, {
        agents: ["grok"],
        signal: reading.signal,
        providers: { discovery: testDiscovery, identity: testIdentity }
      })
    ).rejects.toThrow("stop read");
  });

  it("counts an application only when its bundle id matches, and an unreadable plist by its path", async () => {
    const plist = (id: string) =>
      `<?xml version="1.0"?><plist><dict><key>CFBundleIdentifier</key>\n\t<string>${id}</string></dict></plist>`;
    const recipe: ProbeRecipe = {
      specificationVersion: "discovery-v1",
      agent: "my-agent",
      displayName: "My Agent",
      kind: "app",
      commands: [],
      // An app name another product shares, like the Codex app installed as ChatGPT.app.
      appPaths: ["/Applications/MyAgent.app", "/Applications/Shared.app"],
      appBundleIds: ["com.example.myagent"],
      configPaths: [],
      mcpConfigPaths: [],
      warnings: []
    };
    const detect = async (files: Record<string, string>) => {
      const [installation] = await detectAgents(machine({ files }), {
        providers: { discovery: { "my-agent": recipe }, identity: testIdentity }
      });
      return installation;
    };
    expect((await detect({ "/Applications/Shared.app/Contents/Info.plist": plist("com.example.other") }))?.status).toBe(
      "missing"
    );
    expect(
      (await detect({ "/Applications/Shared.app/Contents/Info.plist": plist("com.example.myagent") }))?.evidence
    ).toEqual([{ kind: "app", path: "/Applications/Shared.app" }]);
    expect((await detect({ "/Applications/Shared.app/Contents/Info.plist": "bplist00" }))?.status).toBe("found");
  });

  it.each(["constructor", "__proto__", "toString"])("throws capability-unsupported for %s", async (agent) => {
    await expect(
      detectAgents(machine(), { agents: [agent], providers: { discovery: testDiscovery, identity: testIdentity } })
    ).rejects.toMatchObject({
      code: "capability-unsupported"
    });
  });

  it("checks every recipe path before running anything, and lets a recipe's own home rule win", async () => {
    const calls: string[] = [];
    const recorder: MemoryCommand = (args) => {
      calls.push(args.join(" "));
      return { stdout: "codex-cli 1.0.0" };
    };
    const broken: ProbeRecipe = {
      ...builtinProbeRecipes.codex,
      auth: { credentialFiles: [{ path: { agentHome: "no-such-agent", path: "auth.json" } }] }
    };
    await expect(
      detectAgents(machine({ commands: { "/opt/bin/codex": recorder } }), {
        providers: { discovery: { codex: broken }, identity: testIdentity }
      })
    ).rejects.toMatchObject({ code: "capability-unsupported" });
    expect(calls).toEqual([]);

    const ownHome: ProbeRecipe = { ...builtinProbeRecipes.codex, home: { defaultPath: [".codex-alt"] } };
    const [codex] = await detectAgents(machine({ files: { [`${HOME}/.codex-alt/sessions/session.jsonl`]: "" } }), {
      versionProbe: false,
      providers: { discovery: { codex: ownHome }, identity: testIdentity }
    });
    expect(codex?.evidence).toEqual([{ kind: "config", path: `${HOME}/.codex-alt/sessions` }]);
  });

  it("tells too much output and defects apart from a command that cannot start", async () => {
    const failing = (error: unknown): MemoryPlatform => {
      const base = machine({ files: { "/opt/bin/codex": "" } });
      return { ...base, process: { run: () => Promise.reject(error) } };
    };
    const tooMuch = Object.assign(new Error("codex wrote more than 4194304 bytes to stdout"), {
      code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
    });
    expect((await detectOne(failing(tooMuch), "codex")).problems).toMatchObject([{ reason: "output-too-large" }]);
    expect(
      (await detectOne(failing(Object.assign(new Error("spawn"), { code: "ENOENT" })), "codex")).problems
    ).toMatchObject([{ reason: "start-failed" }]);
    await expect(detectOne(failing(new TypeError("platform bug")), "codex")).rejects.toThrow("platform bug");
  });
});
