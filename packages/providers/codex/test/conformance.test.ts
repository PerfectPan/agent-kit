import { describe, expect, it } from "vite-plus/test";
import {
  createMemoryPlatform,
  hookDialectConformance,
  probeRecipeConformance,
  usageDecoderConformance,
  type ProbeRecipeSamples
} from "@rivus/agent-kit-testing/public";
import { homeFromRule } from "@rivus/agent-kit-catalog/spi";
import { codex } from "../src/identity.js";
import { codexProbe } from "../src/discovery.js";
import { codexHookDialect } from "../src/hooks.js";
import { codexUsageDecoder } from "../src/usage.js";
import { codexSamples } from "./fixtures/hooks.js";
import { readUsageHome } from "./support.js";
const ok = (stdout: string, stderr = "") => ({ code: 0, stdout, stderr });
const samples: ProbeRecipeSamples = {
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
};
const platform = createMemoryPlatform({ files: await readUsageHome("/u/me"), home: "/u/me" });
const fixtures = {
  platform,
  home: homeFromRule("codex", codex.home, { home: "/u/me", env: {} }),
  sources: [
    { path: "/u/me/.codex/sessions/2026/01/01/rollout-2026-01-01T00-00-00-cx-totals.jsonl", records: 4 },
    { path: "/u/me/.codex/sessions/2026/01/01/rollout-2026-01-01T00-10-00-cx-fork.jsonl", records: 1 },
    { path: "/u/me/.codex/sessions/2026/01/01/rollout-2026-01-01T00-20-00-cx-edge.jsonl", records: 2 },
    { path: "/u/me/.codex/archived_sessions/rollout-2025-12-31T00-00-00-cx-archived.jsonl", records: 1 }
  ]
};
for (const [service, checks] of [
  ["hooks", hookDialectConformance(codexHookDialect, { samples: codexSamples }, { codex: codexHookDialect })],
  ["discovery", probeRecipeConformance(codexProbe, samples, { codex: codex })],
  ["usage", usageDecoderConformance(codexUsageDecoder, fixtures)]
] as const) {
  describe(`codex ${service} conformance`, () => {
    for (const { name, run } of checks) {
      it(`${name}`, async () => {
        await expect(run()).resolves.toBeUndefined();
      });
    }
  });
}
