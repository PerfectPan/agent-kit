import { builtinHookDialects } from "@rivus/agent-kit-harness";
import { describe, expect, it } from "vite-plus/test";

import { type HookDialectSample, hookDialectConformance } from "../src/hook-dialect-conformance.js";
import { claudeCodeSamples } from "./fixtures/hooks/claude-code.js";
import { codexSamples } from "./fixtures/hooks/codex.js";
import { cursorSamples } from "./fixtures/hooks/cursor.js";
import { geminiCliSamples } from "./fixtures/hooks/gemini-cli.js";
import { grokSamples } from "./fixtures/hooks/grok.js";
import { opencodeSamples } from "./fixtures/hooks/opencode.js";
import { piSamples } from "./fixtures/hooks/pi.js";

const samples: Record<keyof typeof builtinHookDialects, readonly HookDialectSample[]> = {
  "claude-code": claudeCodeSamples,
  codex: codexSamples,
  cursor: cursorSamples,
  "gemini-cli": geminiCliSamples,
  grok: grokSamples,
  opencode: opencodeSamples,
  pi: piSamples
};

for (const [agent, dialect] of Object.entries(builtinHookDialects)) {
  describe(`${agent} hook dialect conformance`, () => {
    for (const { name, run } of hookDialectConformance(dialect, {
      samples: samples[dialect.agent as keyof typeof samples]
    })) {
      it(`${name}`, async () => {
        await expect(run()).resolves.toBeUndefined();
      });
    }
  });
}
