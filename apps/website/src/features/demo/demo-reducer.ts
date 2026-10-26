import {
  changedFieldKeys,
  changedLineIndexes,
  demoView,
  initialSelection,
  isBlockedOutput,
  nextAutoplayStep,
  selectAgent,
  selectTask,
  type DemoSelection,
  type DemoView,
  type TaskKey
} from "./snippets.ts";
import type { SupportRow } from "../landing/index.ts";
import type { TimedEvent } from "../../hooks/use-timed-events.ts";

type Phase = "idle" | "working" | "blocked";

export interface DemoState {
  readonly selection: DemoSelection;
  readonly raw: boolean;
  readonly hopNonce: number;
  readonly phase: Phase;
  readonly shown: number;
  readonly flashNonce: number;
  readonly flashFields: ReadonlySet<string>;
  readonly flashCode: ReadonlySet<number>;
  readonly flashOutput: ReadonlySet<number>;
  readonly previousView: DemoView;
}

export type DemoAction =
  | { readonly type: "task"; readonly task: TaskKey; readonly rows: readonly SupportRow[] }
  | { readonly type: "agent"; readonly agentId: string; readonly rows: readonly SupportRow[] }
  | { readonly type: "autoplay"; readonly rows: readonly SupportRow[] }
  | { readonly type: "raw"; readonly value: boolean }
  | { readonly type: "transition"; readonly view: DemoView; readonly motion: boolean }
  | { readonly type: "clear-flash" }
  | { readonly type: "show"; readonly count: number }
  | { readonly type: "phase"; readonly phase: Phase };

export function initialDemoState(rows: readonly SupportRow[]): DemoState {
  const selection = initialSelection(rows);
  const view = demoView(selection, rows);
  return {
    selection,
    raw: false,
    hopNonce: 0,
    phase: "idle",
    shown: view.output.length,
    flashNonce: 0,
    flashFields: new Set(),
    flashCode: new Set(),
    flashOutput: new Set(),
    previousView: view
  };
}

export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "task":
      return {
        ...state,
        selection: selectTask(state.selection, action.task, action.rows),
        hopNonce: state.hopNonce + 1
      };
    case "agent":
      return {
        ...state,
        selection: selectAgent(state.selection, action.agentId, action.rows),
        hopNonce: state.hopNonce + 1
      };
    case "autoplay":
      return { ...state, selection: nextAutoplayStep(state.selection, action.rows) };
    case "raw":
      return { ...state, raw: action.value };
    case "transition":
      return {
        ...state,
        flashFields: new Set(changedFieldKeys(state.previousView.fields, action.view.fields)),
        flashCode: new Set(changedLineIndexes(state.previousView.code, action.view.code)),
        flashOutput: new Set(changedLineIndexes(state.previousView.output, action.view.output)),
        flashNonce: state.flashNonce + 1,
        previousView: action.view,
        shown: action.motion ? 0 : action.view.output.length,
        phase: action.motion ? "working" : "idle"
      };
    case "clear-flash":
      return { ...state, flashFields: new Set(), flashCode: new Set(), flashOutput: new Set() };
    case "show":
      return { ...state, shown: action.count };
    case "phase":
      return { ...state, phase: action.phase };
  }
}

/** Timings are part of the demo, while scheduling and cancellation belong to the hook. */
export function demoSequence(view: DemoView, motion: boolean): readonly TimedEvent<DemoAction>[] {
  const events: TimedEvent<DemoAction>[] = [
    { delay: 0, event: { type: "transition", view, motion } },
    { delay: 200, event: { type: "clear-flash" } }
  ];
  if (motion) {
    view.output.forEach((_, index) =>
      events.push({ delay: 50 * (index + 1), event: { type: "show", count: index + 1 } })
    );
    const blocked = isBlockedOutput(view.output);
    events.push({ delay: 1200, event: { type: "phase", phase: blocked ? "blocked" : "idle" } });
    if (blocked) {
      events.push({ delay: 2100, event: { type: "phase", phase: "idle" } });
    }
  }
  return events;
}
