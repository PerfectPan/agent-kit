import { builtinProbeRecipes, type ProbeRecipe, versionFromOutput } from "@rivus/agent-kit-discovery";
import { describe, expect, it } from "vitest";

import { probeRecipeConformance, type ProbeRecipeSamples } from "../src/probe-recipe-conformance.js";

const ok = (stdout: string, stderr = "") => ({ code: 0, stdout, stderr });

/** Outputs of the real commands, with account details replaced. */
const SAMPLES: Readonly<Record<string, ProbeRecipeSamples>> = {
  "claude-code": {
    versions: [
      { output: ok("2.1.286 (Claude Code)\n"), version: { output: "2.1.286 (Claude Code)", number: "2.1.286" } }
    ],
    auth: [
      {
        output: ok('{\n  "loggedIn": true,\n  "authMethod": "claude.ai",\n  "email": "someone@example.invalid"\n}\n'),
        reading: { loggedIn: true, method: "claude.ai" }
      },
      {
        output: {
          code: 1,
          stdout: '{"loggedIn": false, "authMethod": "none", "apiProvider": "firstParty"}',
          stderr: ""
        },
        reading: { loggedIn: false }
      },
      { output: { code: 1, stdout: "", stderr: "error: unknown command 'auth'" }, reading: undefined }
    ],
    credentialFiles: [
      {
        path: "~/.claude.json",
        json: { numStartups: 3, oauthAccount: { emailAddress: "someone@example.invalid" } },
        reading: { loggedIn: true, method: "claude.ai" }
      },
      { path: "~/.claude.json", json: { numStartups: 3 }, reading: { loggedIn: false } }
    ]
  },
  codex: {
    versions: [{ output: ok("codex-cli 0.154.0\n"), version: { output: "codex-cli 0.154.0", number: "0.154.0" } }],
    auth: [
      { output: ok("", "Logged in using ChatGPT\n"), reading: { loggedIn: true, method: "chatgpt" } },
      { output: ok("", "Logged in using an API key - sk-***1234\n"), reading: { loggedIn: true, method: "api-key" } },
      {
        output: ok("", "Logged in using Amazon Bedrock AWS access keys\n"),
        reading: { loggedIn: true, method: "bedrock-access-keys" }
      },
      { output: ok("", "Logged in using a method added later\n"), reading: { loggedIn: true } },
      {
        output: { code: 1, stdout: "", stderr: "WARNING: proceeding, even though...\nNot logged in\n" },
        reading: { loggedIn: false }
      },
      { output: { code: 1, stdout: "", stderr: "Error checking login status: bad file" }, reading: undefined }
    ],
    credentialFiles: [
      {
        path: "~/.codex/auth.json",
        json: { auth_mode: "chatgpt", OPENAI_API_KEY: null, tokens: { id_token: "x" } },
        reading: { loggedIn: true, method: "chatgpt" }
      },
      { path: "~/.codex/auth.json", json: { OPENAI_API_KEY: "sk-x" }, reading: { loggedIn: true } },
      { path: "~/.codex/auth.json", json: { OPENAI_API_KEY: null }, reading: { loggedIn: false } },
      { path: "~/.codex/auth.json", json: [], reading: undefined }
    ]
  },
  grok: {
    credentialFiles: [
      {
        path: "~/.grok/auth.json",
        json: { "https://example.invalid/scope": { token: "x" } },
        reading: { loggedIn: true }
      },
      { path: "~/.grok/auth.json", json: {}, reading: { loggedIn: false } }
    ],
    versions: [
      {
        output: ok("grok 1.0.46 (2765805b9442)\n"),
        version: { output: "grok 1.0.46 (2765805b9442)", number: "1.0.46" }
      }
    ]
  },
  opencode: {
    versions: [{ output: ok("1.18.4\n"), version: { output: "1.18.4", number: "1.18.4" } }],
    credentialFiles: [
      {
        path: "~/.local/share/opencode/auth.json",
        json: { anthropic: { type: "oauth", refresh: "r", access: "a", expires: 1 } },
        reading: { loggedIn: true }
      },
      { path: "~/.local/share/opencode/auth.json", json: { broken: { type: "other" } }, reading: { loggedIn: false } }
    ]
  },
  cursor: {
    auth: [
      { output: ok('{"status":"authenticated","isAuthenticated":true}'), reading: { loggedIn: true } },
      { output: ok('{"status":"unauthenticated","isAuthenticated":false}'), reading: { loggedIn: false } },
      { output: { code: 1, stdout: '{"status":"error"}', stderr: "" }, reading: undefined }
    ]
  }
};

for (const recipe of Object.values(builtinProbeRecipes)) {
  describe(`${recipe.agent} probe recipe conformance`, () => {
    for (const { name, run } of probeRecipeConformance(recipe, SAMPLES[recipe.agent])) {
      it(`${name}`, async () => {
        await expect(run()).resolves.toBeUndefined();
      });
    }
  });
}

describe("probe recipe conformance catches", () => {
  const good: ProbeRecipe = {
    specificationVersion: "discovery-v1",
    agent: "my-agent",
    displayName: "My Agent",
    kind: "cli",
    commands: ["my-agent"],
    appPaths: [],
    configPaths: ["~/.my-agent"],
    mcpConfigPaths: [],
    version: { args: ["--version"], parse: versionFromOutput, sideEffects: [] },
    warnings: []
  };
  const failure = async (recipe: ProbeRecipe, check: string, samples?: ProbeRecipeSamples): Promise<unknown> => {
    const found = probeRecipeConformance(recipe, samples).find((candidate) => candidate.name.startsWith(check));
    if (found === undefined) {
      throw new Error(`no check named ${check}`);
    }
    return found.run().then(
      () => undefined,
      (error: unknown) => error
    );
  };

  it("passes a well-formed third-party recipe", async () => {
    for (const { run } of probeRecipeConformance(good)) {
      await expect(run()).resolves.toBeUndefined();
    }
  });

  it.each([
    ["an alias as the id", { ...good, agent: "claude" }, "names a catalog agent"],
    [
      "another display name for a catalog agent",
      { ...good, agent: "codex", displayName: "OpenAI Codex" },
      "names a catalog agent"
    ],
    ["a command with a path", { ...good, commands: ["/usr/bin/my-agent"] }, "probes bare command names"],
    [
      "an empty argument",
      { ...good, version: { args: [""], parse: versionFromOutput, sideEffects: [] } },
      "probes bare command names"
    ],
    [
      "a login command that is not one of its commands",
      { ...good, auth: { command: { command: "other", args: ["status"], parse: () => undefined, sideEffects: [] } } },
      "probes bare command names"
    ],
    [
      "a version probe with a blank side effect",
      { ...good, version: { args: ["--version"], parse: versionFromOutput, sideEffects: [""] } },
      "probes bare command names"
    ],
    [
      "a blank side effect",
      { ...good, auth: { command: { args: ["status"], parse: () => undefined, sideEffects: [" "] } } },
      "probes bare command names"
    ],
    [
      "a credential parser that throws",
      {
        ...good,
        auth: {
          credentialFiles: [
            {
              path: "~/.my-agent/auth.json",
              parse: (json: unknown) => ({ loggedIn: Object.keys(json as object).length > 0 })
            }
          ]
        }
      },
      "parsers accept any output"
    ],
    ["a relative path", { ...good, configPaths: [".my-agent"] }, "checks only absolute"],
    [
      "a path above an agent home",
      { ...good, home: { defaultPath: [".x"] }, configPaths: [{ agentHome: "my-agent", path: "../y" }] },
      "checks only absolute"
    ],
    ["an agent home without a rule", { ...good, configPaths: [{ agentHome: "my-agent" }] }, "checks only absolute"],
    [
      "a parser that throws",
      {
        ...good,
        version: {
          args: ["--version"],
          parse: (output: { stdout: string }) => ({ output: JSON.parse(output.stdout) as string })
        }
      },
      "parsers accept any output"
    ],
    [
      "a version with a number that is not in its output",
      { ...good, version: { args: ["--version"], parse: () => ({ output: "x", number: "1.0" }) } },
      "parsers accept any output"
    ]
  ] as const)("rejects %s", async (_, recipe, check) => {
    expect(await failure(recipe as ProbeRecipe, check)).toBeInstanceOf(Error);
  });

  it("rejects a login parser that passes on a value from its input", async () => {
    const leaky: ProbeRecipe = {
      ...good,
      auth: {
        command: {
          args: ["status"],
          parse: (output) => ({ loggedIn: true, method: output.stdout.trim() || "none" }),
          sideEffects: []
        }
      }
    };
    const samples: ProbeRecipeSamples = {
      auth: [{ output: { code: 0, stdout: "api_key", stderr: "" }, reading: { loggedIn: true, method: "api_key" } }]
    };
    expect(await failure(leaky, "never returns a credential value", samples)).toBeInstanceOf(Error);
  });

  it("rejects a parser that passes on the first characters of a token", async () => {
    const slicing: ProbeRecipe = {
      ...good,
      auth: {
        command: {
          args: ["status"],
          parse: (output) => ({ loggedIn: true, method: output.stdout.trim().slice(0, 12) || "none" }),
          sideEffects: []
        }
      }
    };
    const samples: ProbeRecipeSamples = {
      auth: [{ output: { code: 0, stdout: "ok", stderr: "" }, reading: { loggedIn: true, method: "ok" } }]
    };
    expect(await failure(slicing, "never returns a credential value", samples)).toBeInstanceOf(Error);
  });

  it("rejects a login command or a parsed credential file without samples", async () => {
    const withCommand: ProbeRecipe = {
      ...good,
      auth: { command: { args: ["status"], parse: () => ({ loggedIn: true }), sideEffects: [] } }
    };
    expect(await failure(withCommand, "never returns a credential value")).toBeInstanceOf(Error);
    const withFile: ProbeRecipe = {
      ...good,
      auth: { credentialFiles: [{ path: "~/.my-agent/auth.json", parse: () => ({ loggedIn: true }) }] }
    };
    expect(await failure(withFile, "never returns a credential value")).toBeInstanceOf(Error);
    const sampled: ProbeRecipeSamples = {
      credentialFiles: [{ path: "~/.my-agent/auth.json", json: { token: "x" }, reading: { loggedIn: true } }]
    };
    expect(await failure(withFile, "never returns a credential value", sampled)).toBeUndefined();
  });

  it("rejects a sample its parser reads differently", async () => {
    const samples: ProbeRecipeSamples = {
      versions: [
        { output: { code: 0, stdout: "my-agent 2.0", stderr: "" }, version: { output: "my-agent 2.0", number: "2.1" } }
      ]
    };
    expect(await failure(good, "reads its sample outputs", samples)).toBeInstanceOf(Error);
  });
});
