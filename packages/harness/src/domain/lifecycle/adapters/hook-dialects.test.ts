import { isAgentKitError } from "@rivus/agent-kit-catalog";
import { describe, expect, it } from "vitest";

import type { HookDialect, HookDialects } from "../index.js";
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

  it("reads a promise on a payload path as absent instead of throwing", () => {
    for (const agent of Object.keys(builtinHookDialects)) {
      const event = readHookEvent(agent, { hook_event_name: "Stop", session_id: Promise.resolve("s") }, {});
      expect(event.sessionId).toBeUndefined();
    }
    expect(
      readHookEvent("claude-code", { hook_event_name: "Stop", session_id: Promise.resolve("s") }, {}).nativeEvent
    ).toBe("Stop");
  });

  it("reads a promise on the sniffing path as no evidence", () => {
    const event = readHookEvent("claude-code", { hookEventName: Promise.resolve("pre_tool_use") }, {});
    expect(event.agent).toBe("claude-code");
    expect(event.phase).toBe("unknown");
  });

  it("reads a promise on a dialect path as absent instead of throwing", () => {
    const event = readHookEvent("cursor", { cursor_version: "1", workspace_roots: Promise.resolve(["/w"]) }, {});
    expect(event.agent).toBe("cursor");
    expect(event.cwd).toBeUndefined();
  });

  it("throws when reading the path runs a throwing getter on the key it reads", () => {
    const throwing: unknown = Object.create(
      {},
      {
        hook_event_name: { value: "Stop", enumerable: true },
        session_id: {
          get() {
            throw new Error("boom");
          },
          enumerable: true
        }
      }
    );
    expect(() => readHookEvent("claude-code", throwing, {})).toThrow("boom");
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

  it("reads a third-party dialect inherited from a builtin through its prototype", () => {
    const inherited = Object.create(builtinHookDialects["claude-code"]);
    inherited.agent = "my-agent";
    expect(
      readHookEvent(
        "my-agent",
        { hook_event_name: "Stop", session_id: "s" },
        {},
        { adapters: { "my-agent": inherited as HookDialect } }
      )
    ).toEqual({
      agent: "my-agent",
      phase: "finish",
      scope: "turn",
      outcome: "completed",
      nativeEvent: "Stop",
      sessionId: "s"
    });
  });

  it("reads a third-party dialect whose facts are getters", () => {
    class Foreign {
      get specificationVersion(): "harness-v1" {
        return "harness-v1";
      }
      get agent(): "my-agent" {
        return "my-agent";
      }
      get delivery(): "command" {
        return "command";
      }
      get fields(): { event: { paths: readonly string[][] } } {
        return { event: { paths: [["kind"]] } };
      }
      get events(): Record<string, { lifecycle: { phase: "finish"; scope: "turn" } }> {
        return { done: { lifecycle: { phase: "finish", scope: "turn" } } };
      }
    }
    expect(readHookEvent("my-agent", { kind: "done" }, {}, { adapters: { "my-agent": new Foreign() } })).toEqual({
      agent: "my-agent",
      phase: "finish",
      scope: "turn",
      nativeEvent: "done"
    });
  });

  it("reads a third-party dialect live, so a change after a first read applies", () => {
    const mine: { -readonly [K in keyof HookDialect]: HookDialect[K] } = {
      specificationVersion: "harness-v1",
      agent: "my-agent",
      delivery: "command",
      fields: { event: { paths: [["kind"]] } },
      events: { done: { lifecycle: { phase: "finish", scope: "turn" } } }
    };
    const adapters = { "my-agent": mine };
    expect(readHookEvent("my-agent", { kind: "done" }, {}, { adapters })).toEqual({
      agent: "my-agent",
      phase: "finish",
      scope: "turn",
      nativeEvent: "done"
    });
    mine.events = { done: { lifecycle: { phase: "start", scope: "session" } } };
    expect(readHookEvent("my-agent", { kind: "done" }, {}, { adapters })).toEqual({
      agent: "my-agent",
      phase: "start",
      scope: "session",
      nativeEvent: "done"
    });
  });

  it("reads `runsHooksOf` live: a list added or deleted after a first read applies", () => {
    const mine: { -readonly [K in keyof HookDialect]: HookDialect[K] } = {
      specificationVersion: "harness-v1",
      agent: "my-agent",
      delivery: "command",
      fields: { event: { paths: [["kind"]] } },
      events: { done: { lifecycle: { phase: "finish", scope: "turn" } } }
    };
    const adapters = { "my-agent": mine };
    readHookEvent("my-agent", { kind: "done" }, {}, { adapters });
    mine.runsHooksOf = [{ agent: "claude-code", files: [], byDefault: true, events: { Halt: "done" } }];
    expect(readHookEvent("my-agent", { kind: "Halt" }, {}, { adapters })).toEqual({
      agent: "my-agent",
      phase: "finish",
      scope: "turn",
      nativeEvent: "Halt"
    });
    delete mine.runsHooksOf;
    expect(readHookEvent("my-agent", { kind: "Halt" }, {}, { adapters })).toEqual({
      agent: "my-agent",
      nativeEvent: "Halt",
      phase: "unknown"
    });
  });

  it("reads the builtin dialects live, so a changed builtin applies to later reads", () => {
    const claudeCode = builtinHookDialects["claude-code"] as { events: Record<string, unknown> };
    const events = claudeCode.events;
    claudeCode.events = { ...events, Hooked: { lifecycle: { phase: "start", scope: "session" } } };
    try {
      expect(readHookEvent("claude-code", { hook_event_name: "Hooked" }, {})).toEqual({
        agent: "claude-code",
        phase: "start",
        scope: "session",
        nativeEvent: "Hooked"
      });
    } finally {
      claudeCode.events = events;
    }
  });

  it("never reads an unrelated adapter entry: a null or unreadable one does not affect another agent's read", () => {
    const unreadable = {
      get runsHooksOf(): never {
        throw new Error("boom");
      }
    } as unknown as HookDialect;
    const plain = readHookEvent("claude-code", { hook_event_name: "Stop", session_id: "s" }, {});
    const adapters = { codex: null, "gemini-cli": unreadable } as unknown as HookDialects;
    expect(readHookEvent("claude-code", { hook_event_name: "Stop", session_id: "s" }, {}, { adapters })).toEqual(plain);
  });

  it('reads a dialect keyed "__proto__" in the adapters table as its own entry', () => {
    const dialect = {
      specificationVersion: "harness-v1",
      agent: "__proto__",
      delivery: "command",
      fields: { event: { paths: [["kind"]] } },
      events: { Stop: { lifecycle: { phase: "idle" } } }
    } as unknown as HookDialect;
    const adapters = {} as Record<string, HookDialect>;
    Object.defineProperty(adapters, "__proto__", {
      value: dialect,
      enumerable: true,
      configurable: true,
      writable: true
    });
    expect(
      readHookEvent("__proto__" as never, { kind: "Stop" }, {}, { adapters: adapters as unknown as HookDialects })
    ).toEqual({
      agent: "__proto__",
      phase: "idle",
      nativeEvent: "Stop"
    });
  });

  it("reads absent or null dialect lists as empty instead of throwing", () => {
    const base = {
      specificationVersion: "harness-v1",
      agent: "my-agent",
      delivery: "command",
      fields: { event: { paths: [["kind"]] } },
      events: { done: { lifecycle: { phase: "finish", scope: "turn" } } }
    };
    const adaptersOf = (dialect: unknown): { adapters: HookDialects } => ({
      adapters: { "my-agent": dialect } as unknown as HookDialects
    });
    expect(readHookEvent("my-agent", { kind: "done" }, {}, adaptersOf({ ...base, runsHooksOf: null }))).toEqual({
      agent: "my-agent",
      phase: "finish",
      scope: "turn",
      nativeEvent: "done"
    });
    expect(
      readHookEvent(
        "my-agent",
        { kind: "done", sid: "s" },
        {},
        adaptersOf({
          ...base,
          fields: { event: { paths: [["kind"]] }, sessionId: null }
        })
      )
    ).toEqual({ agent: "my-agent", phase: "finish", scope: "turn", nativeEvent: "done" });
    expect(
      readHookEvent(
        "my-agent",
        { kind: "done", sid: "s" },
        {},
        adaptersOf({
          ...base,
          fields: { event: { paths: [["kind"]] }, sessionId: { paths: null, env: ["SID"] } }
        })
      )
    ).toEqual({ agent: "my-agent", phase: "finish", scope: "turn", nativeEvent: "done" });
    expect(
      readHookEvent(
        "my-agent",
        { kind: "done", sid: "s" },
        { SID: "env-s" },
        adaptersOf({
          ...base,
          fields: { event: { paths: [["kind"]] }, sessionId: { paths: null, env: ["SID"] } }
        })
      )
    ).toEqual({ agent: "my-agent", phase: "finish", scope: "turn", nativeEvent: "done", sessionId: "env-s" });
    expect(
      readHookEvent(
        "my-agent",
        { kind: "done", sid: "s" },
        {},
        adaptersOf({
          ...base,
          fields: { event: { paths: [["kind"]] }, sessionId: { paths: [["sid"]], env: null } }
        })
      )
    ).toEqual({ agent: "my-agent", phase: "finish", scope: "turn", nativeEvent: "done", sessionId: "s" });
    expect(
      readHookEvent(
        "claude-code",
        { hook_event_name: "Stop" },
        { CURSOR_VERSION: "1" },
        {
          adapters: { cursor: null } as unknown as HookDialects
        }
      )
    ).toEqual(readHookEvent("claude-code", { hook_event_name: "Stop" }, {}));
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
