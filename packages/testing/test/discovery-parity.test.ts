import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  builtinProbeRecipes,
  detectAgents,
  expandProbePath,
  type Evidence,
  type Installation,
  type ProbePath,
  type ProbeRecipe,
  versionFromOutput
} from "@rivus/agent-kit-discovery";
import type { OperatingSystem } from "@rivus/agent-kit-platform";
import { describe, expect, it } from "vitest";

import { createMemoryPlatform, type MemoryCommand, type MemoryPlatform } from "../src/memory-platform.js";

// The reports in fixtures/discovery/agent-finder were produced by agent-finder's MoonBit scanner from the probe next
// to each one: its own test inputs, plus a synthetic probe that covers more statuses. Each probe becomes a memory
// machine, and detectAgents, given agent-finder's own provider facts (providers.json) as recipes, must report the
// same agents. The built-in recipes start from those facts and correct some of them; the last test lists which.

/** agent-finder's input: what its host layer found out about the machine. */
interface HostProbe {
  readonly os: string;
  readonly home: string;
  /** Command name to the path it resolved to on `PATH`. */
  readonly commands: Readonly<Record<string, string>>;
  readonly executablePaths: Readonly<Record<string, boolean>>;
  readonly existingPaths: Readonly<Record<string, boolean>>;
  /** `<path> <version args>` to the version output. */
  readonly versions: Readonly<Record<string, string>>;
}

interface FinderRecord {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly status: string;
  readonly command: string | null;
  readonly app_path: string | null;
  readonly version: string | null;
  readonly evidence: readonly { kind: string; value: string; exists: boolean; reason: string }[];
  readonly config_paths: readonly string[];
  readonly mcp_config_paths: readonly string[];
  readonly warnings: readonly string[];
}

interface ParityCase {
  readonly name: string;
  readonly source: string;
  readonly probe: HostProbe;
  readonly report: { readonly agents: readonly FinderRecord[] };
}

const fixtures = fileURLToPath(new URL("fixtures/discovery/agent-finder", import.meta.url));
const cases: ParityCase[] = readdirSync(fixtures)
  .filter((file) => file.endsWith(".json") && file !== "providers.json")
  .map((file) => ({ name: file.slice(0, -5), ...JSON.parse(readFileSync(`${fixtures}/${file}`, "utf8")) }));

/** One of agent-finder's provider specs. */
interface ProviderSpec {
  readonly id: string;
  readonly displayName: string;
  readonly kind: ProbeRecipe["kind"];
  readonly commandCandidates: readonly string[];
  readonly appPathCandidates: readonly string[];
  readonly configPathCandidates: readonly string[];
  readonly mcpConfigPathCandidates: readonly string[];
  readonly versionProbe: string | null;
  readonly warnings: readonly string[];
}

const { providers } = JSON.parse(readFileSync(`${fixtures}/providers.json`, "utf8")) as {
  providers: readonly ProviderSpec[];
};

/** agent-finder's provider facts as recipes; only `versioned-cli` providers have a version probe. */
const finderRecipes: Readonly<Record<string, ProbeRecipe>> = Object.fromEntries(
  providers.map((provider) => [
    provider.id,
    {
      specificationVersion: "discovery-v1",
      agent: provider.id,
      displayName: provider.displayName,
      kind: provider.kind,
      commands: provider.commandCandidates,
      appPaths: provider.appPathCandidates,
      configPaths: provider.configPathCandidates,
      mcpConfigPaths: provider.mcpConfigPathCandidates,
      ...(provider.versionProbe === null
        ? {}
        : { version: { args: provider.versionProbe.split(" "), parse: versionFromOutput, sideEffects: [] } }),
      warnings: provider.warnings
    } satisfies ProbeRecipe
  ])
);

/**
 * The machine a probe describes: each resolved command's directory on `PATH`, an executable command as a program that
 * answers its version probe from `versions` (and fails otherwise), a non-executable one as a plain file, and every
 * existing path. On Windows, `PATHEXT` lists the extensions of the resolved commands.
 */
function machineOf(probe: HostProbe): MemoryPlatform {
  const windows = probe.os === "win32";
  const separator = windows ? "\\" : "/";
  const resolved = [...new Set(Object.values(probe.commands))];
  const commands: Record<string, MemoryCommand> = {};
  const files: Record<string, string> = {};
  for (const path of resolved) {
    if (probe.executablePaths[path]) {
      commands[path] = (args) => {
        const version = probe.versions[`${path} ${args.join(" ")}`];
        return version === undefined ? { code: 1, stderr: "unknown option" } : { stdout: `${version}\n` };
      };
    } else {
      files[path] = "";
    }
  }
  const existing = Object.keys(probe.existingPaths).filter((path) => probe.existingPaths[path]);
  for (const path of existing.filter((path) => !existing.some((other) => other.startsWith(`${path}/`)))) {
    files[path] = "";
  }
  const dirs = [...new Set(resolved.map((path) => path.slice(0, path.lastIndexOf(separator))))];
  const extensions = [...new Set(resolved.map((path) => /\.[^.\\/]+$/.exec(path)?.[0] ?? ""))].filter(Boolean);
  return createMemoryPlatform({
    os: probe.os as OperatingSystem,
    home: probe.home,
    env: windows ? { Path: dirs.join(";"), PATHEXT: extensions.join(";") } : { PATH: dirs.join(":") },
    files: { ...files, [`${probe.home}/.parity`]: "" },
    commands
  });
}

const FINDER_EVIDENCE: Record<Evidence["kind"], { kind: string; reason: string }> = {
  command: { kind: "command", reason: "command resolved on PATH" },
  version: { kind: "version", reason: "version probe exited successfully" },
  app: { kind: "app_path", reason: "app path exists" },
  config: { kind: "config", reason: "config path exists" },
  "mcp-config": { kind: "mcp_config", reason: "MCP config path exists" }
};

/** The candidate as agent-finder wrote it: agent-home paths with their default home under `~`. */
function candidate(path: ProbePath, recipe: ProbeRecipe): string {
  return expandProbePath(path, { env: {}, home: "~" }, recipe);
}

function toFinderRecord(installation: Installation): FinderRecord {
  const recipe = finderRecipes[installation.agent];
  if (recipe === undefined) {
    throw new Error(`no recipe for ${installation.agent}`);
  }
  return {
    id: installation.agent,
    name: installation.displayName,
    type: installation.kind,
    status: installation.status,
    command: installation.command ?? null,
    app_path: installation.appPath ?? null,
    version: installation.version?.output ?? null,
    evidence: installation.evidence.map((item) => ({
      kind: FINDER_EVIDENCE[item.kind].kind,
      value: item.kind === "version" ? `${item.path} ${item.args.join(" ")}` : item.path,
      exists: true,
      reason: FINDER_EVIDENCE[item.kind].reason
    })),
    config_paths: recipe.configPaths.map((path) => candidate(path, recipe)),
    mcp_config_paths: recipe.mcpConfigPaths.map((path) => candidate(path, recipe)),
    warnings: installation.warnings
  };
}

describe("parity with agent-finder", () => {
  it("has agent-finder's 26 agents in its order, then Grok", () => {
    expect(Object.keys(finderRecipes)).toEqual(cases[0]?.report.agents.map((agent) => agent.id));
    expect(Object.keys(builtinProbeRecipes)).toEqual([...Object.keys(finderRecipes), "grok"]);
    expect(cases.map((parityCase) => parityCase.name).toSorted()).toEqual([
      "doctor-config-only",
      "host-probe",
      "mixed",
      "scan-runnable",
      "scan-windows"
    ]);
  });

  for (const parityCase of cases) {
    it(`reports what agent-finder reported for ${parityCase.name} (${parityCase.source})`, async () => {
      const installations = await detectAgents(machineOf(parityCase.probe), { recipes: finderRecipes });
      expect(installations.map(toFinderRecord)).toEqual(parityCase.report.agents);
    });
  }

  it("counts statuses like agent-finder's doctor", async () => {
    const parityCase = cases.find((candidateCase) => candidateCase.name === "doctor-config-only");
    expect(parityCase).toBeDefined();
    const installations = await detectAgents(machineOf(parityCase?.probe as HostProbe), { recipes: finderRecipes });
    const count = (status: string) => installations.filter((installation) => installation.status === status).length;
    expect([installations.length, count("found"), count("runnable"), count("missing"), count("unknown")]).toEqual([
      26, 1, 0, 25, 0
    ]);
    expect(installations.flatMap((installation) => installation.warnings).length).toBeGreaterThan(0);
  });

  it("resolves Windows commands through PATHEXT like agent-finder's resolveCommand", async () => {
    const platform = createMemoryPlatform({
      os: "win32",
      home: "C:\\Users\\tester",
      env: {
        PATH: "C:\\Program Files\\Microsoft VS Code\\bin;C:\\Windows\\System32",
        PATHEXT: ".COM;.EXE;.BAT;.CMD"
      },
      files: { "C:\\Program Files\\Microsoft VS Code\\bin\\code.CMD": "" }
    });
    const [vscode] = await detectAgents(platform, { agents: ["vscode-copilot"] });
    expect(vscode?.command).toBe("C:\\Program Files\\Microsoft VS Code\\bin\\code.CMD");
  });

  it("differs from agent-finder's facts exactly where upstream sources corrected them", () => {
    const facts = (recipe: ProbeRecipe): Record<Fact, unknown> => ({
      name: recipe.displayName,
      kind: recipe.kind,
      commands: recipe.commands,
      appPaths: recipe.appPaths.map((path) => candidate(path, recipe)),
      configPaths: recipe.configPaths.map((path) => candidate(path, recipe)),
      mcpConfigPaths: recipe.mcpConfigPaths.map((path) => candidate(path, recipe)),
      version: recipe.version?.args,
      warnings: recipe.warnings
    });
    const builtin: Readonly<Record<string, ProbeRecipe>> = builtinProbeRecipes;
    const differences = providers.flatMap((provider) => {
      const [ours, theirs] = [builtin[provider.id], finderRecipes[provider.id]];
      if (ours === undefined || theirs === undefined) {
        return [`${provider.id} is missing`];
      }
      const [mine, original] = [facts(ours), facts(theirs)];
      return FACTS.filter((fact) => JSON.stringify(mine[fact]) !== JSON.stringify(original[fact])).map(
        (fact) => `${provider.id} ${fact}`
      );
    });
    expect(differences.toSorted()).toEqual(
      EXPECTED_DIFFERENCES.map(({ agent, fact }) => `${agent} ${fact}`).toSorted()
    );
  });
});

type Fact = "name" | "kind" | "commands" | "appPaths" | "configPaths" | "mcpConfigPaths" | "version" | "warnings";
const FACTS: readonly Fact[] = [
  "name",
  "kind",
  "commands",
  "appPaths",
  "configPaths",
  "mcpConfigPaths",
  "version",
  "warnings"
];

const OPENCODE_CONFIG = "https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/config/paths.ts";
const CLINE_PATHS = "https://github.com/cline/cline/blob/main/sdk/packages/shared/src/storage/paths.ts";
const VSCODE_USER_DATA =
  "https://github.com/microsoft/vscode/blob/main/src/vs/platform/environment/node/userDataPath.ts";
const COMMAND_CODE = "https://registry.npmjs.org/command-code/latest";
const CURSOR_CLI = "https://cursor.com/docs/cli/reference/authentication";
const ANTIGRAVITY = "https://antigravity.google/docs/cli/install";
const ROO_CONFIG = "https://github.com/RooCodeInc/Roo-Code/blob/main/src/services/roo-config/index.ts";
const COPILOT_HOME = "https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference";
const OPENCLAW_ENVIRONMENT = "https://github.com/openclaw/openclaw/blob/main/docs/help/environment.md";
const PI_CONFIG = "https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/config.ts";
const KIMI_SHARE = "https://github.com/MoonshotAI/kimi-cli/blob/main/src/kimi_cli/share.py";
const DEVIN_DESKTOP = "https://docs.devin.ai/desktop/devin-desktop-faq";
const HERMES_CONSTANTS = "https://github.com/NousResearch/hermes-agent/blob/main/hermes_constants.py";
const TRAE_RULES = "https://docs.trae.ai/ide/rules";
const CODEX_APP = "https://learn.chatgpt.com/docs/config-file/config-advanced";

/**
 * Every fact of a built-in recipe that differs from agent-finder's, with the source that settled it. A `warnings`
 * entry means agent-finder's "needs validation" caveat was dropped because the source confirmed the facts, or
 * replaced by a caveat naming what is still unverified.
 */
const EXPECTED_DIFFERENCES: readonly { agent: string; fact: Fact; source: string }[] = [
  // Catalog owns display names.
  { agent: "opencode", fact: "name", source: "packages/catalog/src/domain/adapters/opencode.ts" },
  // opencode also reads opencode.jsonc.
  { agent: "opencode", fact: "mcpConfigPaths", source: OPENCODE_CONFIG },
  { agent: "opencode", fact: "warnings", source: OPENCODE_CONFIG },
  // Cline has a CLI and keeps its data in ~/.cline; the extension's VS Code storage is checked instead of the
  // shared extensions directory, which says nothing about Cline.
  { agent: "cline", fact: "commands", source: "https://registry.npmjs.org/cline/latest" },
  { agent: "cline", fact: "configPaths", source: `${CLINE_PATHS} and ${VSCODE_USER_DATA}` },
  { agent: "cline", fact: "warnings", source: CLINE_PATHS },
  { agent: "codebuddy", fact: "warnings", source: "https://www.codebuddy.ai/docs/cli/env-vars" },
  // The command-code package installs command-code and commandcode, and keeps its data in ~/.commandcode.
  { agent: "command-code", fact: "commands", source: COMMAND_CODE },
  { agent: "command-code", fact: "configPaths", source: COMMAND_CODE },
  { agent: "command-code", fact: "warnings", source: COMMAND_CODE },
  // The CLI's command is kiro-cli; kiro opens the IDE.
  { agent: "kiro-cli", fact: "commands", source: "https://kiro.dev/docs/reference/settings" },
  { agent: "kiro-cli", fact: "warnings", source: "https://kiro.dev/docs/reference/settings" },
  // The Cursor CLI is cursor-agent with its configuration in ~/.cursor; its other name, agent, is left out because
  // other agents install a command with that name.
  { agent: "cursor", fact: "commands", source: CURSOR_CLI },
  { agent: "cursor", fact: "configPaths", source: CURSOR_CLI },
  { agent: "cursor", fact: "warnings", source: CURSOR_CLI },
  // Antigravity's CLI is agy with its directory under ~/.gemini; the application's user directories are unverified.
  { agent: "antigravity", fact: "commands", source: ANTIGRAVITY },
  { agent: "antigravity", fact: "configPaths", source: ANTIGRAVITY },
  { agent: "antigravity", fact: "warnings", source: ANTIGRAVITY },
  { agent: "roo-code", fact: "configPaths", source: `${ROO_CONFIG} and ${VSCODE_USER_DATA}` },
  { agent: "roo-code", fact: "warnings", source: ROO_CONFIG },
  // The Copilot CLI is copilot with its home in ~/.copilot; gh and ~/.config/gh belong to the GitHub CLI.
  { agent: "github-copilot", fact: "commands", source: COPILOT_HOME },
  { agent: "github-copilot", fact: "configPaths", source: COPILOT_HOME },
  { agent: "github-copilot", fact: "warnings", source: COPILOT_HOME },
  { agent: "amp", fact: "configPaths", source: "https://ampcode.com/docs/cli/settings" },
  { agent: "amp", fact: "warnings", source: "https://ampcode.com/docs/cli/settings" },
  { agent: "openclaw", fact: "warnings", source: OPENCLAW_ENVIRONMENT },
  { agent: "neovate", fact: "warnings", source: "https://github.com/neovateai/neovate-code/blob/master/src/paths.ts" },
  // Pi keeps its configuration in ~/.pi/agent.
  { agent: "pi", fact: "configPaths", source: PI_CONFIG },
  { agent: "pi", fact: "warnings", source: PI_CONFIG },
  // The qodercli package installs qoder and qodercli.
  { agent: "qoder", fact: "commands", source: "https://registry.npmjs.org/@qoder-ai/qodercli/latest" },
  { agent: "qoder", fact: "warnings", source: "https://docs.qoder.com/cli/settings-reference" },
  // Still unverified: the command may be zen.
  { agent: "zencoder", fact: "warnings", source: "https://docs.zencoder.ai (search result only)" },
  { agent: "kimi-code-cli", fact: "warnings", source: KIMI_SHARE },
  // Windsurf is now Devin Desktop; both names are checked.
  { agent: "windsurf", fact: "commands", source: DEVIN_DESKTOP },
  { agent: "windsurf", fact: "appPaths", source: DEVIN_DESKTOP },
  { agent: "windsurf", fact: "mcpConfigPaths", source: "https://docs.devin.ai/desktop/cascade/mcp" },
  { agent: "windsurf", fact: "warnings", source: DEVIN_DESKTOP },
  // The Codex app is installed as ChatGPT.app (bundle id com.openai.codex). Its home is the Codex CLI's, which any
  // codex run creates, so it is no evidence of the app; the bundle id tells the app apart from the ChatGPT app.
  { agent: "codex-desktop", fact: "appPaths", source: CODEX_APP },
  { agent: "codex-desktop", fact: "configPaths", source: CODEX_APP },
  { agent: "codex-desktop", fact: "mcpConfigPaths", source: CODEX_APP },
  { agent: "codex-desktop", fact: "warnings", source: CODEX_APP },
  // aider reads ~/.aider.conf.yml and keeps state in ~/.aider; it never reads ~/.config/aider.
  { agent: "aider", fact: "configPaths", source: "https://github.com/Aider-AI/aider/blob/main/aider/args.py" },
  { agent: "hermes", fact: "warnings", source: HERMES_CONSTANTS },
  // Trae is an IDE, with a separate CN build.
  { agent: "trae", fact: "kind", source: TRAE_RULES },
  { agent: "trae", fact: "commands", source: TRAE_RULES },
  { agent: "trae", fact: "configPaths", source: TRAE_RULES },
  { agent: "trae", fact: "version", source: TRAE_RULES },
  { agent: "trae", fact: "warnings", source: TRAE_RULES }
];
