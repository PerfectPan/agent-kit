import { builtinProviders } from "@rivus/agent-kit/providers";
import { expect, it } from "vite-plus/test";

import {
  MY_AGENT,
  TASK_ORDER,
  changedFieldKeys,
  changedLineIndexes,
  demoView,
  isBlockedOutput,
  isSwapField,
  maxOutputFieldCount,
  nextAutoplayStep,
  nextTaskKey,
  outputFields,
  plainText,
  selectAgent,
  selectTask,
  type DemoSelection
} from "./demo-state.ts";
import type { SupportRow } from "./support.ts";
import { supportFromProviders } from "./support.ts";

const rows: readonly SupportRow[] = [
  { id: "claude-code", discovery: true, hooks: true, install: true, sessions: true, usage: true, acp: true },
  { id: "cursor", discovery: true, hooks: true, install: true, sessions: false, usage: false, acp: false },
  { id: "pi", discovery: true, hooks: true, install: true, sessions: false, usage: true, acp: false },
  { id: "grok", discovery: true, hooks: true, install: true, sessions: true, usage: true, acp: true }
];

const on = (task: DemoSelection["task"], agentId: string): DemoSelection => ({ task, agentId });

it("refuses an agent that lacks the capability", () => {
  const next = selectAgent(on("drive", "claude-code"), "cursor", rows);
  expect(next).toEqual(on("drive", "claude-code"));
  const view = demoView(on("drive", "cursor"), rows);
  expect(view.agents.find((agent) => agent.id === "cursor")?.enabled).toBe(false);
  expect(view.agents.find((agent) => agent.pressed)?.id).toBe("claude-code");
});

it("falls back to a supported agent when the task changes", () => {
  const next = selectTask(on("detect", "cursor"), "sessions", rows);
  expect(next.agentId).toBe("claude-code");
  expect(plainText(demoView(next, rows).code)).toContain('"claude-code"');
});

it("keeps the agent when the next task supports it", () => {
  expect(selectTask(on("detect", "pi"), "usage", rows).agentId).toBe("pi");
});

it("adds the provider option for my-agent and leaves coordinate alone", () => {
  const hooks = plainText(demoView(on("hooks", MY_AGENT), rows).code);
  expect(hooks).toContain('const myAgent = { id: "my-agent", hooks: myHookDialect };');
  expect(hooks).toContain("providers: [myAgent]");
  expect(hooks).toContain('readHookEvent("my-agent"');

  const coordinate = plainText(demoView(on("coordinate", MY_AGENT), rows).code);
  expect(coordinate).toContain('runTurn("my-agent", token)');
  expect(coordinate).not.toContain("providers:");
  expect(coordinate).not.toContain("myAgent");
});

it("has code and output for every supported agent of every task", () => {
  const builtin = supportFromProviders(builtinProviders);
  for (const task of TASK_ORDER) {
    for (const row of builtin) {
      if (!demoView(on(task, row.id), builtin).agents.find((agent) => agent.id === row.id)?.enabled) {
        continue;
      }
      const view = demoView(on(task, row.id), builtin);
      expect(plainText(view.code), `${task} ${row.id} code`).toContain(`"${row.id}"`);
      expect(plainText(view.output).length, `${task} ${row.id} output`).toBeGreaterThan(0);
      if (task !== "drive") {
        expect(plainText(view.output), `${task} ${row.id} output`).toContain(`"${row.id}"`);
      }
    }
    const mine = demoView(on(task, MY_AGENT), builtin);
    expect(plainText(mine.code)).toContain(`"${MY_AGENT}"`);
    expect(plainText(mine.output).length).toBeGreaterThan(0);
    if (task === "coordinate") {
      expect(plainText(mine.code)).not.toContain("providers:");
    } else {
      expect(plainText(mine.code)).toContain("providers: [myAgent]");
    }
  }
});

it("cycles autoplay through supported Agents, then the next task", () => {
  expect(nextAutoplayStep(on("detect", "claude-code"), rows)).toEqual(on("detect", "cursor"));
  expect(nextAutoplayStep(on("detect", "grok"), rows)).toEqual(on("detect", MY_AGENT));
  expect(nextAutoplayStep(on("detect", MY_AGENT), rows)).toEqual(on("hooks", "claude-code"));
  expect(nextAutoplayStep(on("sessions", "claude-code"), rows)).toEqual(on("sessions", "grok"));
  expect(nextAutoplayStep(on("coordinate", MY_AGENT), rows)).toEqual(on("detect", "claude-code"));
});

it("marks a LeaseHeld sample as blocked", () => {
  expect(isBlockedOutput(demoView(on("coordinate", "codex"), rows).output)).toBe(true);
  expect(isBlockedOutput(demoView(on("detect", "claude-code"), rows).output)).toBe(false);
});

it("moves the task tab with the arrow keys", () => {
  expect(nextTaskKey("detect", "ArrowRight")).toBe("hooks");
  expect(nextTaskKey("detect", "ArrowLeft")).toBe("coordinate");
  expect(nextTaskKey("usage", "Home")).toBe("detect");
  expect(nextTaskKey("usage", "End")).toBe("coordinate");
  expect(nextTaskKey("usage", "Enter")).toBeNull();
});

it("keeps the approved snippet text", () => {
  const detect = demoView(on("detect", "claude-code"), rows);
  expect(plainText(detect.code)).toBe(
    [
      'import { detectAgents } from "@rivus/agent-kit/discovery";',
      "",
      'const found = (await detectAgents(platform)).find((i) => i.agent === "claude-code");'
    ].join("\n")
  );
  expect(plainText(detect.output)).toContain('status: "runnable"');

  const usage = demoView(on("usage", "grok"), rows);
  expect(plainText(usage.output)).toContain('granularity: "turn"');
  expect(plainText(demoView(on("usage", "claude-code"), rows).output)).toContain('granularity: "request"');

  expect(plainText(demoView(on("hooks", "pi"), rows).output)).toContain('nativeEvent: "before_agent_start"');
  expect(demoView(on("coordinate", "codex"), rows).packageName).toBe("@rivus/agent-kit-collab");
});

it("flattens sample output into aligned key/value fields", () => {
  expect(outputFields("detect", "claude-code")).toEqual([
    { key: "agent", value: "claude-code" },
    { key: "status", value: "runnable" },
    { key: "auth", value: "logged-in" },
    { key: "version", value: "…" }
  ]);
  expect(outputFields("usage", "grok")).toEqual([
    { key: "agent", value: "grok" },
    { key: "granularity", value: "turn" },
    { key: "inputTokens", value: "18304" },
    { key: "cacheReadTokens", value: "16128" },
    { key: "outputTokens", value: "412" }
  ]);
  expect(outputFields("hooks", "pi").find((field) => field.key === "nativeEvent")?.value).toBe("before_agent_start");
  expect(demoView(on("detect", "claude-code"), rows).fields).toEqual(outputFields("detect", "claude-code"));
  expect(maxOutputFieldCount()).toBe(5);
});

it("marks Agent id and values that change as swap fields", () => {
  expect(isSwapField("agent")).toBe(true);
  expect(isSwapField("nativeEvent")).toBe(true);
  expect(isSwapField("granularity")).toBe(true);
  expect(isSwapField("worker A")).toBe(true);
  expect(isSwapField("status")).toBe(false);
  expect(changedFieldKeys(outputFields("usage", "claude-code"), outputFields("usage", "grok"))).toEqual([
    "agent",
    "granularity"
  ]);
  const from = demoView(on("detect", "claude-code"), rows).code;
  const to = demoView(on("detect", "grok"), rows).code;
  expect(changedLineIndexes(from, to).length).toBeGreaterThan(0);
});
