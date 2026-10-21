import { readHookEvent as contextReadHookEvent } from "@rivus/agent-kit-harness/public/events";
import { hooksTable } from "../providers/hooks.js";
import type { ProviderOptions } from "../providers/types.js";

export {
  builtinHookDialects,
  heartbeatSignal,
  INITIAL_LIFECYCLE_STATE,
  lifecycleStatus,
  reduceLifecycle
} from "@rivus/agent-kit-harness/public/events";
export type {
  BlockSource,
  FieldPath,
  FieldSource,
  ForeignHooks,
  HeartbeatSignal,
  HookDialect,
  HostMarkers,
  HookDialects,
  HookEventSpec,
  HookOutput,
  HookTimeout,
  LifecycleBlocker,
  LifecycleClock,
  LifecycleEvent,
  LifecycleMapping,
  LifecycleOutcome,
  LifecyclePhase,
  LifecycleScope,
  LifecycleState,
  LifecycleStatus,
  LifecycleSwitch,
  PayloadFields,
  TerminalHost,
  TerminalIdentity
} from "@rivus/agent-kit-harness/public/events";

export type ReadHookEventOptions = ProviderOptions<Parameters<typeof contextReadHookEvent>[3]>;

export function readHookEvent(
  agent: Parameters<typeof contextReadHookEvent>[0],
  payload: Parameters<typeof contextReadHookEvent>[1],
  env: Parameters<typeof contextReadHookEvent>[2],
  options: ReadHookEventOptions = {}
): ReturnType<typeof contextReadHookEvent> {
  return contextReadHookEvent(agent, payload, env, { ...options, providers: { hooks: hooksTable(options.providers) } });
}
