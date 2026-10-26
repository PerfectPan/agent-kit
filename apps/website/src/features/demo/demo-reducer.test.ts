import { expect, it } from "vite-plus/test";

import { demoReducer, demoSequence, initialDemoState } from "./demo-reducer.ts";
import { demoView } from "./snippets.ts";
import type { SupportRow } from "../landing/index.ts";

const rows: readonly SupportRow[] = [
  { id: "claude-code", discovery: true, hooks: true, install: true, sessions: true, usage: true, acp: true },
  { id: "cursor", discovery: true, hooks: true, install: true, sessions: false, usage: false, acp: false }
];

it("starts settled and falls back on task changes without losing the output mode", () => {
  const initial = initialDemoState(rows);
  expect(initial.phase).toBe("idle");
  expect(initial.shown).toBe(demoView(initial.selection, rows).output.length);
  const raw = demoReducer(initial, { type: "raw", value: true });
  const cursor = demoReducer(raw, { type: "agent", agentId: "cursor", rows });
  const sessions = demoReducer(cursor, { type: "task", task: "sessions", rows });
  expect(sessions.selection).toEqual({ task: "sessions", agentId: "claude-code" });
  expect(sessions.raw).toBe(true);
  expect(sessions.hopNonce).toBe(2);
  expect(initial.raw).toBe(false);
  expect(initial.selection.agentId).toBe("claude-code");
});

it("ignores unsupported selection and only restarts the hop for user actions", () => {
  const sessions = demoReducer(initialDemoState(rows), { type: "task", task: "sessions", rows });
  const ignored = demoReducer(sessions, { type: "agent", agentId: "cursor", rows });
  expect(ignored.selection).toBe(sessions.selection);
  const advanced = demoReducer(ignored, { type: "autoplay", rows });
  expect(advanced.selection.agentId).toBe("my-agent");
  expect(advanced.hopNonce).toBe(ignored.hopNonce);
});

it("flashes changed fields and lines, then clears only the flash state", () => {
  const initial = initialDemoState(rows);
  const selected = demoReducer(initial, { type: "agent", agentId: "cursor", rows });
  const view = demoView(selected.selection, rows);
  const next = demoReducer(selected, { type: "transition", view, motion: true });
  expect([...next.flashFields]).toEqual(["agent"]);
  expect([...next.flashCode]).toEqual([2]);
  expect([...next.flashOutput]).toEqual([0]);
  expect(next.flashNonce).toBe(1);
  expect(next.phase).toBe("working");
  expect(next.shown).toBe(0);
  const shown = demoReducer(next, { type: "show", count: 1 });
  const clear = demoReducer(shown, { type: "clear-flash" });
  expect([...clear.flashFields, ...clear.flashCode, ...clear.flashOutput]).toEqual([]);
  expect(clear.shown).toBe(1);
  expect(clear.phase).toBe("working");
  expect(initial.previousView.fields[0]?.value).toBe("claude-code");
});

it("keeps the line, flash, work and blocked delays", () => {
  let state = demoReducer(initialDemoState(rows), { type: "task", task: "coordinate", rows });
  const sequence = demoSequence(demoView(state.selection, rows), true);
  expect(sequence.map(({ delay }) => delay)).toEqual([0, 200, 50, 100, 1200, 2100]);
  for (const { event } of [...sequence].sort((a, b) => a.delay - b.delay)) {
    state = demoReducer(state, event);
    if (event.type === "phase" && event.phase === "blocked") {
      expect(state.phase).toBe("blocked");
    }
  }
  expect(state.phase).toBe("idle");
  expect(state.shown).toBe(2);
  expect(demoSequence(demoView(initialDemoState(rows).selection, rows), true).map(({ delay }) => delay)).toEqual([
    0, 200, 50, 1200
  ]);
});

it("reveals all output without a working phase under reduced motion, but preserves flashes", () => {
  const state = demoReducer(initialDemoState(rows), { type: "task", task: "coordinate", rows });
  const view = demoView(state.selection, rows);
  const sequence = demoSequence(view, false);
  expect(sequence.map(({ delay }) => delay)).toEqual([0, 200]);
  const next = demoReducer(state, sequence[0]!.event);
  expect(next.phase).toBe("idle");
  expect(next.shown).toBe(view.output.length);
  expect(next.flashFields.size).toBeGreaterThan(0);
});
