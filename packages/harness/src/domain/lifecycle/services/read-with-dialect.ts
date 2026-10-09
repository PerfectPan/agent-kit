import { type Env, ownValue, readField } from "../policies/payload-fields.js";
import {
  type HookDialect,
  type HookEventSpec,
  foreignHooksOf,
  type LifecycleSwitch,
  type PayloadFields
} from "../value-objects/hook-dialect.js";
import type { LifecycleEvent, LifecycleMapping } from "../value-objects/lifecycle-event.js";
import type { PayloadView } from "../value-objects/payload-view.js";

function isSwitch(lifecycle: HookEventSpec["lifecycle"]): lifecycle is LifecycleSwitch {
  return "cases" in lifecycle;
}

function ownSpec(dialect: HookDialect, name: string): HookEventSpec | undefined {
  return ownValue(dialect.events, name);
}

/**
 * The event spec for a name in a payload: a native name, one of its aliases, or a foreign agent's name that this
 * agent renames when it runs that agent's hooks.
 */
function eventSpec(dialect: HookDialect, nativeEvent: string): HookEventSpec | undefined {
  const own = ownSpec(dialect, nativeEvent);
  if (own !== undefined) {
    return own;
  }
  const aliased = Object.values(dialect.events).find((spec) => spec.aliases?.includes(nativeEvent) === true);
  if (aliased !== undefined) {
    return aliased;
  }
  for (const foreign of foreignHooksOf(dialect)) {
    const renamed = ownValue(foreign.events, nativeEvent);
    if (typeof renamed === "string") {
      return ownSpec(dialect, renamed);
    }
  }
  return undefined;
}

/** The mapping of an event; a switch picks its case from the payload. */
function resolveMapping(spec: HookEventSpec, payload: PayloadView): LifecycleMapping {
  if (!isSwitch(spec.lifecycle)) {
    return spec.lifecycle;
  }
  const value = payload.get(spec.lifecycle.field);
  const chosen = value === undefined ? undefined : ownValue(spec.lifecycle.cases, value);
  return chosen ?? spec.lifecycle.otherwise;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** Reads one payload with one dialect. Unknown shapes and events read as phase `unknown`; nothing throws. */
export function readWithDialect(dialect: HookDialect, payload: PayloadView, env: Env): LifecycleEvent {
  const { fields } = dialect;
  const read = (key: keyof PayloadFields) => readField(payload, env, fields[key]);
  const nativeEvent = read("event") ?? "";
  const spec = eventSpec(dialect, nativeEvent);
  const event: Mutable<LifecycleEvent> = {
    agent: dialect.agent,
    ...(spec === undefined ? { phase: "unknown" } : resolveMapping(spec, payload)),
    nativeEvent
  };

  for (const key of ["turnId", "sessionId", "cwd", "transcriptPath"] as const) {
    const value = read(key);
    if (value !== undefined) {
      event[key] = value;
    }
  }
  const marker = readField(payload, env, fields.subagentMarker ?? fields.subagentId);
  if (spec?.subagent === true || marker !== undefined) {
    const id = read("subagentId");
    const type = read("subagentType");
    event.subagent = { ...(id === undefined ? {} : { id }), ...(type === undefined ? {} : { type }) };
  }
  const toolName = read("toolName");
  if (toolName !== undefined) {
    const callId = read("toolCallId");
    event.tool = callId === undefined ? { name: toolName } : { name: toolName, callId };
  }
  return event;
}
