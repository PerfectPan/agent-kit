import type { Bundle } from "../../src/domain/bundle/index.js";

/** The stable shim a hook command points at; it never runs in these tests. */
export const SHIM = "/opt/demo/bin/demo-hook --agent {agent}";

/** An application's bundle: observer hooks for every agent with a dialect, and one skill. */
export function demoBundle(version = "1.0.0", overrides: Partial<Bundle> = {}): Bundle {
  return {
    owner: "demo-app",
    version,
    digest: `digest-${version}`,
    artifacts: [
      {
        type: "hooks",
        command: SHIM,
        timeoutSeconds: 5,
        events: {
          "claude-code": ["SessionStart", "UserPromptSubmit", "Stop"],
          codex: ["SessionStart", "UserPromptSubmit", "Stop"],
          "gemini-cli": ["SessionStart", "BeforeAgent", "AfterAgent"],
          grok: ["SessionStart", "UserPromptSubmit", "Stop"],
          cursor: ["sessionStart", "beforeSubmitPrompt", "stop"],
          opencode: ["session.created", "session.status", "session.idle"],
          pi: ["session_start", "agent_start", "agent_end", "session_shutdown"]
        }
      },
      {
        type: "skill",
        name: "demo-skill",
        files: { "SKILL.md": "---\nname: demo-skill\ndescription: Demo\n---\nHello\n" }
      }
    ],
    legacyMarkers: ["legacy-demo hook"],
    ...overrides
  };
}
