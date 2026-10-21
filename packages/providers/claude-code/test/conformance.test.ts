import { describe, expect, it } from "vite-plus/test";
import {
  createMemoryPlatform,
  hookDialectConformance,
  probeRecipeConformance,
  usageDecoderConformance,
  type ProbeRecipeSamples
} from "@rivus/agent-kit-testing/public";
import { homeFromRule } from "@rivus/agent-kit-catalog/spi";
import { claudeCode } from "../src/identity.js";
import { claudeCodeProbe } from "../src/discovery.js";
import { claudeCodeHookDialect } from "../src/hooks.js";
import { claudeCodeUsageDecoder } from "../src/usage.js";
import { claudeCodeSamples } from "./fixtures/hooks.js";
import { readUsageHome } from "./support.js";
const ok = (stdout: string, stderr = "") => ({ code: 0, stdout, stderr });
const samples: ProbeRecipeSamples = {
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
};
const platform = createMemoryPlatform({ files: await readUsageHome("/u/me"), home: "/u/me" });
const fixtures = {
  platform,
  home: homeFromRule("claude-code", claudeCode.home, { home: "/u/me", env: {} }),
  sources: [
    { path: "/u/me/.claude/projects/-u-me-work/s-usage.jsonl", records: 5 },
    { path: "/u/me/.claude/projects/-u-me-work/s-usage/subagents/agent-helper.jsonl", records: 1 }
  ]
};
for (const [service, checks] of [
  [
    "hooks",
    hookDialectConformance(
      claudeCodeHookDialect,
      { samples: claudeCodeSamples },
      { "claude-code": claudeCodeHookDialect }
    )
  ],
  ["discovery", probeRecipeConformance(claudeCodeProbe, samples, { "claude-code": claudeCode })],
  ["usage", usageDecoderConformance(claudeCodeUsageDecoder, fixtures)]
] as const) {
  describe(`claude-code ${service} conformance`, () => {
    for (const { name, run } of checks) {
      it(`${name}`, async () => {
        await expect(run()).resolves.toBeUndefined();
      });
    }
  });
}
