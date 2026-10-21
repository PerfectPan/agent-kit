import { describe, expect, it } from "vite-plus/test";
import { readHookEvent } from "@rivus/agent-kit-harness";
import { geminiCliHookDialect } from "../src/hooks.js";

const builtinHookDialects = { "gemini-cli": geminiCliHookDialect };
const testHooks = builtinHookDialects;

describe("Gemini CLI hook event names", () => {
  it("S45 (agent-presence#86): Gemini CLI uses its own event names, none of Claude Code's", () => {
    const gemini = Object.keys(builtinHookDialects["gemini-cli"].events);
    expect(gemini.toSorted()).toEqual(
      [
        "SessionStart",
        "SessionEnd",
        "BeforeAgent",
        "AfterAgent",
        "BeforeTool",
        "AfterTool",
        "BeforeModel",
        "AfterModel",
        "BeforeToolSelection",
        "PreCompress",
        "Notification"
      ].toSorted()
    );
    for (const claudeOnly of ["UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop"]) {
      expect(
        readHookEvent("gemini-cli", { hook_event_name: claudeOnly }, {}, { providers: { hooks: testHooks } }).phase
      ).toBe("unknown");
    }
  });
});
