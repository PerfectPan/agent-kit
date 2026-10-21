import { builtinHookDialects as testHooks } from "./providers.js";
import { readHookEvent } from "@rivus/agent-kit-harness";
import { describe, expect, it } from "vite-plus/test";

import { type HookDialectSample, hookDialectConformance } from "../src/hook-dialect-conformance.js";
import { claudeCodeSamples } from "../../providers/claude-code/test/fixtures/hooks.js";
import { cursorSamples } from "../../providers/cursor/test/fixtures/hooks.js";
import { geminiCliSamples } from "../../providers/gemini-cli/test/fixtures/hooks.js";
import { grokSamples } from "../../providers/grok/test/fixtures/hooks.js";
import { opencodeSamples } from "../../providers/opencode/test/fixtures/hooks.js";
import { piSamples } from "../../providers/pi/test/fixtures/hooks.js";
import { codexSamples } from "./fixtures/hooks/codex.js";
import { cursorHostSamples } from "./fixtures/hooks/cursor-host.js";
import { grokHostSamples } from "./fixtures/hooks/grok-host.js";

const samples: Record<keyof typeof testHooks, readonly HookDialectSample[]> = {
  "claude-code": claudeCodeSamples,
  codex: codexSamples,
  cursor: cursorSamples,
  "gemini-cli": geminiCliSamples,
  grok: grokSamples,
  opencode: opencodeSamples,
  pi: piSamples
};

for (const [agent, dialect] of Object.entries(testHooks)) {
  describe(`${agent} hook dialect conformance`, () => {
    for (const { name, run } of hookDialectConformance(
      dialect,
      {
        samples: samples[dialect.agent as keyof typeof samples]
      },
      testHooks
    )) {
      it(`${name}`, async () => {
        await expect(run()).resolves.toBeUndefined();
      });
    }
  });
}

// Cross-agent host resolution needs the full table, assembled only by this test package.
describe("Cursor running Claude Code hooks", () => {
  for (const sample of cursorHostSamples) {
    it(`${sample.name}`, () => {
      expect(
        readHookEvent(sample.declaredAgent!, sample.payload, sample.env ?? {}, { providers: { hooks: testHooks } })
      ).toStrictEqual(sample.expected);
    });
  }
});

describe("Grok running Claude Code hooks", () => {
  for (const sample of grokHostSamples) {
    it(`${sample.name}`, () => {
      expect(
        readHookEvent(sample.declaredAgent!, sample.payload, sample.env ?? {}, { providers: { hooks: testHooks } })
      ).toStrictEqual(sample.expected);
    });
  }
});
