import { isAgentKitError } from "@rivus/agent-kit-catalog";
import { describe, expect, it } from "vitest";

import type { HookDialect } from "../index.js";
import { builtinHookDialects, readHookEvent } from "./hook-dialects.js";

describe("readHookEvent", () => {
  it("S30: names the agent that really ran a hook registered for Claude Code", () => {
    const payload = { hook_event_name: "PreToolUse", session_id: "s1", tool_name: "Bash" };
    expect(readHookEvent("claude-code", payload, {}).agent).toBe("claude-code");
    expect(readHookEvent("claude-code", { ...payload, hookEventName: "pre_tool_use" }, {}).agent).toBe("grok");
    expect(readHookEvent("claude-code", { ...payload, cursor_version: "3.13.25" }, {}).agent).toBe("cursor");
    expect(readHookEvent("claude-code", payload, { CURSOR_VERSION: "3.13.25" }).agent).toBe("cursor");
    expect(readHookEvent("claude-code", payload, { GROK_SESSION_ID: "" }).agent).toBe("claude-code");
  });

  it("S30: lets payload evidence decide; GROK_SESSION_ID never names Grok, CURSOR_VERSION only for agents Cursor runs", () => {
    const codex = { hook_event_name: "PreToolUse", session_id: "c1", turn_id: "t1", tool_name: "Bash" };
    expect(readHookEvent("codex", codex, { GROK_SESSION_ID: "g1" }).agent).toBe("codex");
    expect(readHookEvent("codex", codex, { CURSOR_VERSION: "3.13.25" }).agent).toBe("codex");
    expect(readHookEvent("gemini-cli", { hook_event_name: "BeforeTool" }, { CURSOR_VERSION: "3.13.25" }).agent).toBe(
      "gemini-cli"
    );
    const fromCursor = { hook_event_name: "preToolUse", cursor_version: "3.13.25", conversation_id: "x" };
    expect(readHookEvent("claude-code", fromCursor, { GROK_SESSION_ID: "g1" }).agent).toBe("cursor");
    expect(readHookEvent("claude-code", { hook_event_name: "Stop" }, { GROK_SESSION_ID: "g1" }).agent).toBe(
      "claude-code"
    );
    expect(readHookEvent("claude-code", { hook_event_name: "Stop" }, { CURSOR_VERSION: "3.13.25" }).agent).toBe(
      "cursor"
    );
  });

  it("reads Cursor's rename of a Claude Code event as Cursor's event", () => {
    const event = readHookEvent(
      "claude-code",
      { hook_event_name: "UserPromptSubmit", generation_id: "g2" },
      {
        CURSOR_VERSION: "3.13.25"
      }
    );
    expect(event).toEqual({
      agent: "cursor",
      nativeEvent: "UserPromptSubmit",
      phase: "start",
      scope: "turn",
      turnId: "g2"
    });
  });

  it("S43: returns the terminal pane apart from the session, preferring the host over tmux", () => {
    const payload = { hook_event_name: "Stop", session_id: "s1" };
    expect(readHookEvent("claude-code", payload, { TMUX_PANE: "%4" }).terminal).toEqual({ host: "tmux", paneId: "%4" });
    expect(readHookEvent("claude-code", payload, { TMUX_PANE: "%4", SUPERSET_TERMINAL_ID: "t-9" }).terminal).toEqual({
      host: "superset",
      paneId: "t-9"
    });
    expect(readHookEvent("claude-code", payload, { CMUX_PANEL_ID: "p-1" }).terminal).toEqual({
      host: "cmux",
      paneId: "p-1"
    });
    expect(readHookEvent("claude-code", payload, {}).terminal).toBeUndefined();
  });

  it("S41: reads unknown shapes as phase unknown without throwing", () => {
    for (const payload of [
      undefined,
      null,
      1,
      "Stop",
      [],
      {},
      { hook_event_name: 7 },
      { hook_event_name: "constructor" }
    ]) {
      for (const agent of Object.keys(builtinHookDialects)) {
        const event = readHookEvent(agent, payload, {});
        expect(event.phase).toBe("unknown");
        expect(event.agent).toBe(agent);
      }
    }
    expect(readHookEvent("claude-code", { hook_event_name: "TeammateIdle" }, {})).toEqual({
      agent: "claude-code",
      nativeEvent: "TeammateIdle",
      phase: "unknown"
    });
  });

  it("reads a field of an unexpected type as absent, at the payload root and along a nested path", () => {
    const numberSession = readHookEvent("claude-code", { hook_event_name: "Stop", session_id: 7 }, {});
    expect(numberSession.phase).toBe("finish");
    expect(numberSession.sessionId).toBeUndefined();
    const nested = readHookEvent("opencode", { type: "session.idle", properties: { info: { id: 9 } } }, {});
    expect(nested.phase).toBe("finish");
    expect(nested.sessionId).toBeUndefined();
    const deep = readHookEvent("opencode", { type: "session.idle", properties: "not a record" }, {});
    expect(deep.phase).toBe("finish");
    expect(deep.sessionId).toBeUndefined();
  });

  it("reads inherited keys as absent", () => {
    const inherited: unknown = Object.create({ hook_event_name: "Stop", session_id: "proto" });
    const event = readHookEvent("claude-code", inherited, {});
    expect(event.phase).toBe("unknown");
    expect(event.sessionId).toBeUndefined();
  });

  it("reads a key polluted onto Object.prototype as absent", () => {
    Object.defineProperty(Object.prototype, "session_id", { value: "polluted", configurable: true });
    try {
      const event = readHookEvent("claude-code", { hook_event_name: "Stop" }, {});
      expect(event.phase).toBe("finish");
      expect(event.sessionId).toBeUndefined();
    } finally {
      delete (Object.prototype as { session_id?: unknown }).session_id;
    }
  });

  it("reads a prototype getter of a class instance as absent", () => {
    class Holder {
      get session_id(): string {
        return "getter";
      }
    }
    const event = readHookEvent("claude-code", Object.assign(new Holder(), { hook_event_name: "Stop" }), {});
    expect(event.phase).toBe("finish");
    expect(event.sessionId).toBeUndefined();
  });

  it("never runs a getter on an unrelated key", () => {
    const throwing: unknown = Object.create(
      {},
      {
        hook_event_name: { value: "Stop", enumerable: true },
        boom: {
          get() {
            throw new Error("boom");
          },
          enumerable: true
        }
      }
    );
    const event = readHookEvent("claude-code", throwing, {});
    expect(event.phase).toBe("finish");
  });

  it("S42: only keeps the tool's name and call id, never its arguments", () => {
    const event = readHookEvent(
      "codex",
      { hook_event_name: "PreToolUse", tool_name: "Bash", tool_use_id: "c1", tool_input: { command: "cat secret" } },
      {}
    );
    expect(event.tool).toEqual({ name: "Bash", callId: "c1" });
    expect(JSON.stringify(event)).not.toContain("secret");
  });

  it("S41: uses a dialect passed for one call and throws for an agent without one", () => {
    const mine: HookDialect = {
      specificationVersion: "harness-v1",
      agent: "my-agent",
      delivery: "plugin",
      fields: { event: { paths: [["kind"]] } },
      events: { done: { lifecycle: { phase: "finish", scope: "turn" } } }
    };
    expect(readHookEvent("my-agent", { kind: "done" }, {}, { adapters: { "my-agent": mine } })).toEqual({
      agent: "my-agent",
      nativeEvent: "done",
      phase: "finish",
      scope: "turn"
    });
    let thrown: unknown;
    try {
      readHookEvent("my-agent", { kind: "done" }, {});
    } catch (error) {
      thrown = error;
    }
    expect(isAgentKitError(thrown) && thrown.code).toBe("capability-unsupported");
  });
});

describe("hook dialect facts", () => {
  it("S44 (agent-presence#85): every command dialect states its timeout unit; only Gemini CLI uses milliseconds", () => {
    const units = Object.fromEntries(
      Object.values(builtinHookDialects).map((dialect) => [dialect.agent, dialect.timeout?.unit])
    );
    expect(units).toEqual({
      "claude-code": "seconds",
      codex: "seconds",
      cursor: "seconds",
      "gemini-cli": "milliseconds",
      grok: "seconds",
      opencode: undefined,
      pi: undefined
    });
  });

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
      expect(readHookEvent("gemini-cli", { hook_event_name: claudeOnly }, {}).phase).toBe("unknown");
    }
  });

  it("S46 (agent-presence#89): Cursor's permission hooks are gates, and Claude Code's PreToolUse becomes one", () => {
    const cursor = builtinHookDialects.cursor;
    const gates = Object.entries(cursor.events)
      .filter(([, spec]) => spec.gate === true)
      .map(([name]) => name);
    expect(gates.toSorted()).toEqual(
      [
        "beforeShellExecution",
        "beforeMCPExecution",
        "beforeReadFile",
        "beforeTabFileRead",
        "subagentStart",
        "preToolUse"
      ].toSorted()
    );
    const renamed = cursor.runsHooksOf?.find((foreign) => foreign.agent === "claude-code")?.events.PreToolUse;
    expect(renamed).toBe("preToolUse");
    const output = cursor.events.preToolUse?.output;
    expect(output).toMatchObject({ invalidStdout: "block", exitCode2: "block", emptyStdout: "undocumented" });
    // An observer registered in Claude Code's settings prints the same thing in every agent that runs it.
    for (const agent of ["claude-code", "cursor", "grok"] as const) {
      const spec = builtinHookDialects[agent].events[agent === "cursor" ? "preToolUse" : "PreToolUse"];
      expect(spec?.output?.passThrough).toBe("{}");
    }
    expect(builtinHookDialects.cursor.runsHooksOf?.[0]?.events.SubagentStart).toBeUndefined();
  });

  it("records which Codex events accept which output fields, and where plain text becomes context", () => {
    const codex = builtinHookDialects.codex.events;
    expect(codex.SessionStart?.output?.fields).toContain("hookSpecificOutput");
    for (const name of ["UserPromptSubmit", "Stop", "SubagentStop"]) {
      expect(codex[name]?.output?.fields).toEqual(expect.arrayContaining(["decision", "reason"]));
    }
    expect(codex.UserPromptSubmit?.output?.fields).toContain("hookSpecificOutput");
    for (const name of ["SessionStart", "UserPromptSubmit", "SubagentStart"]) {
      expect(codex[name]?.output).toMatchObject({ plainStdout: "context", passThrough: "" });
    }
    expect(codex.PreToolUse?.output?.fields).not.toContain("continue");
  });

  it("records that Grok and Cursor run Claude Code's hooks by default", () => {
    for (const agent of ["grok", "cursor"] as const) {
      const foreign = builtinHookDialects[agent].runsHooksOf?.find((entry) => entry.agent === "claude-code");
      expect(foreign?.byDefault).toBe(true);
      expect(foreign?.files).toContain("~/.claude/settings.json");
    }
  });
});
