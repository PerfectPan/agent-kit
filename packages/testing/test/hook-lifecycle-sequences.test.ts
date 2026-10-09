import {
  heartbeatSignal,
  INITIAL_LIFECYCLE_STATE,
  type LifecycleState,
  type LifecycleStatus,
  readHookEvent,
  reduceLifecycle
} from "@rivus/agent-kit-harness";
import { describe, expect, it } from "vite-plus/test";

import type { HookDialectSample } from "../src/hook-dialect-conformance.js";
import { claudeCodeSamples } from "./fixtures/hooks/claude-code.js";
import { codexSamples } from "./fixtures/hooks/codex.js";
import { cursorSamples } from "./fixtures/hooks/cursor.js";
import { geminiCliSamples } from "./fixtures/hooks/gemini-cli.js";
import { grokSamples } from "./fixtures/hooks/grok.js";
import { opencodeSamples } from "./fixtures/hooks/opencode.js";
import { piSamples } from "./fixtures/hooks/pi.js";

// Real fixture payloads, read with readHookEvent and folded with reduceLifecycle in the order an agent sends them:
// one turn per agent, then the same turn with the session start arriving late.

type Step = readonly [sample: string, status: LifecycleStatus];

interface Sequence {
  readonly samples: readonly HookDialectSample[];
  readonly turn: readonly Step[];
  /** The turn start, then a late session start that must not end it. */
  readonly lateSessionStart: readonly [turnStart: string, sessionStart: string];
}

const sequences: Record<string, Sequence> = {
  "claude-code": {
    samples: claudeCodeSamples,
    turn: [
      ["SessionStart before the first prompt has no prompt id", "idle"],
      ["UserPromptSubmit", "working"],
      ["PreToolUse", "working"],
      ["PermissionRequest has no tool_use_id", "blocked"],
      ["PostToolUse", "working"],
      ["SubagentStart", "working"],
      ["PreToolUse inside a subagent", "working"],
      ["SubagentStop", "working"],
      ["Stop", "idle"],
      ["SessionEnd", "idle"]
    ],
    lateSessionStart: ["UserPromptSubmit", "SessionStart with --agent is not a subagent"]
  },
  codex: {
    samples: codexSamples,
    turn: [
      ["SessionStart", "idle"],
      ["UserPromptSubmit", "working"],
      ["PreToolUse", "working"],
      ["PermissionRequest", "blocked"],
      ["PostToolUse", "working"],
      ["SubagentStart", "working"],
      ["PermissionRequest inside a subagent", "blocked"],
      ["PostToolUse inside a sibling subagent", "blocked"],
      ["PreToolUse inside a subagent", "working"],
      ["SubagentStop", "working"],
      ["Stop", "idle"],
      ["SessionEnd", "idle"]
    ],
    lateSessionStart: ["UserPromptSubmit", "SessionStart"]
  },
  cursor: {
    samples: cursorSamples,
    turn: [
      ["sessionStart", "idle"],
      ["beforeSubmitPrompt", "working"],
      ["preToolUse", "working"],
      ["beforeShellExecution", "working"],
      ["subagentStart", "working"],
      ["subagentStop", "working"],
      ["stop completed", "idle"],
      ["sessionEnd", "idle"]
    ],
    lateSessionStart: ["beforeSubmitPrompt", "sessionStart"]
  },
  "gemini-cli": {
    samples: geminiCliSamples,
    turn: [
      ["SessionStart", "idle"],
      ["BeforeAgent", "working"],
      ["BeforeTool", "working"],
      ["Notification ToolPermission", "blocked"],
      ["AfterTool", "working"],
      ["AfterAgent", "idle"],
      ["SessionEnd", "idle"]
    ],
    lateSessionStart: ["BeforeAgent", "SessionStart"]
  },
  grok: {
    samples: grokSamples,
    turn: [
      ["SessionStart", "idle"],
      ["UserPromptSubmit", "working"],
      ["PreToolUse carries no promptId", "working"],
      ["Notification permission_prompt", "blocked"],
      ["PostToolUse", "working"],
      ["SubagentStart", "working"],
      ["PreToolUse inside a subagent", "working"],
      ["SubagentStop", "working"],
      ["Stop at the end of a turn", "idle"],
      ["StopCancelled", "idle"],
      ["SessionEnd", "idle"]
    ],
    lateSessionStart: ["UserPromptSubmit", "SessionStart"]
  },
  opencode: {
    samples: opencodeSamples,
    turn: [
      ["session.created", "idle"],
      ["session.status busy", "working"],
      ["tool.execute.before", "working"],
      ["permission.asked", "blocked"],
      ["permission.replied", "working"],
      ["session.status idle", "idle"],
      ["session.idle", "idle"],
      ["session.deleted", "idle"]
    ],
    lateSessionStart: ["session.status busy", "session.created"]
  },
  pi: {
    samples: piSamples,
    turn: [
      ["session_start", "idle"],
      ["before_agent_start", "working"],
      ["tool_execution_start", "working"],
      ["ui_prompt_start", "blocked"],
      ["ui_prompt_end", "working"],
      ["agent_end", "idle"],
      ["agent_settled", "idle"],
      ["session_shutdown", "idle"]
    ],
    lateSessionStart: ["agent_start", "session_start"]
  }
};

function fold(agent: string, samples: readonly HookDialectSample[], names: readonly string[]) {
  let state: LifecycleState = INITIAL_LIFECYCLE_STATE;
  return names.map((name, index) => {
    const sample = samples.find((candidate) => candidate.name === name);
    if (sample === undefined) {
      throw new Error(`${agent} has no sample named ${name}`);
    }
    const event = readHookEvent(sample.declaredAgent ?? agent, sample.payload, sample.env ?? {});
    const before = state;
    state = reduceLifecycle(state, event, { ttlMs: 180_000, now: index * 1000 });
    return { status: state.status, signal: heartbeatSignal(before, state, event) };
  });
}

describe("hook payloads folded in an agent's order", () => {
  for (const [agent, sequence] of Object.entries(sequences)) {
    it(`${agent}: one turn moves through the expected statuses`, () => {
      const statuses = fold(
        agent,
        sequence.samples,
        sequence.turn.map(([name]) => name)
      ).map((step) => step.status);
      expect(statuses).toEqual(sequence.turn.map(([, status]) => status));
    });

    it(`${agent}: a session start that arrives after the turn started does not end it`, () => {
      const steps = fold(agent, sequence.samples, sequence.lateSessionStart);
      expect(steps.map((step) => step.status)).toEqual(["working", "working"]);
      expect(steps.map((step) => step.signal)).toEqual(["start", undefined]);
    });
  }

  it("codex: a sibling subagent's activity does not close another subagent's or the main agent's prompt", () => {
    const names = [
      "UserPromptSubmit",
      "PermissionRequest",
      "PreToolUse inside a subagent",
      "PostToolUse",
      "PermissionRequest inside a subagent",
      "PostToolUse inside a sibling subagent",
      "PreToolUse inside a subagent"
    ];
    expect(fold("codex", codexSamples, names).map((step) => step.status)).toEqual([
      "working",
      "blocked",
      "blocked",
      "working",
      "blocked",
      "blocked",
      "working"
    ]);
  });

  it("codex: main-agent activity leaves a subagent's prompt open until that subagent stops", () => {
    const names = ["UserPromptSubmit", "PermissionRequest inside a subagent", "PostToolUse", "SubagentStop"];
    expect(fold("codex", codexSamples, names).map((step) => step.status)).toEqual([
      "working",
      "blocked",
      "blocked",
      "working"
    ]);
  });

  it("grok: the late StopCancelled and the subagent stop do not finish the main session", () => {
    const names = sequences.grok!.turn.map(([name]) => name);
    const signals = fold("grok", grokSamples, names).map((step) => step.signal);
    expect(signals[names.indexOf("SubagentStop")]).toBe("heartbeat");
    expect(signals[names.indexOf("Stop at the end of a turn")]).toBe("finish");
    expect(signals[names.indexOf("StopCancelled")]).toBeUndefined();
  });
});
