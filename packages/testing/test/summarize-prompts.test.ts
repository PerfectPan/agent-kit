import { isAgentKitError } from "@rivus/agent-kit-catalog";
import { type SessionPromptsOptions, summarizeSession } from "@rivus/agent-kit-sessions";
import { describe, expect, it } from "vite-plus/test";

import { createMemoryPlatform } from "../src/memory-platform.js";

const rollout =
  '{"timestamp":"2026-01-01T00:00:00.000Z","type":"session_meta","payload":{"id":"s-prompts"}}\n' +
  '{"timestamp":"2026-01-01T00:00:01.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Plan the change"}]}}\n' +
  '{"timestamp":"2026-01-01T00:00:02.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"<environment_context>\\n  <cwd>/work/app</cwd>\\n</environment_context>"}]}}\n' +
  '{"timestamp":"2026-01-01T00:00:03.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10,"output_tokens":2},"last_token_usage":{"input_tokens":10,"output_tokens":2}}}}\n';

describe("summarizeSession prompts option", () => {
  it("rejects caps that are not whole numbers in range", async () => {
    const platform = createMemoryPlatform({ files: { "/codex/rollout.jsonl": rollout } });
    // `null as unknown` is what a JS caller passes where the type says the option is absent.
    for (const prompts of [
      { limit: -1, maxChars: 5 },
      { limit: 1.5, maxChars: 5 },
      { limit: 2, maxChars: 0 },
      null as unknown as SessionPromptsOptions
    ]) {
      const thrown = await summarizeSession(
        platform,
        { agent: "codex", path: "/codex/rollout.jsonl" },
        { prompts }
      ).then(
        (): unknown => undefined,
        (error: unknown): unknown => error
      );
      expect(isAgentKitError(thrown), `expected an AgentKitError for ${JSON.stringify(prompts)}`).toBe(true);
      expect((thrown as { code: string }).code).toBe("invalid-prompts");
    }
  });
});
