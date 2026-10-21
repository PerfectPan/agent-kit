// The hook-path entry, `@rivus/agent-kit/harness/events`: a hook process loads only this, so it reaches nothing but
// the lifecycle domain and the per-agent hook dialects, and stays synchronous. The shell bundles `zod/mini` into the
// built entry, so it imports nothing at runtime even though the payload readers parse through schemas.
export { readHookEvent, type ReadHookEventOptions } from "./domain/lifecycle/adapters/read-hook-event.js";
export {
  type BlockSource,
  INITIAL_LIFECYCLE_STATE,
  type LifecycleClock,
  type LifecycleState,
  type LifecycleStatus
} from "./domain/lifecycle/value-objects/lifecycle-state.js";
export {
  type FieldPath,
  type FieldSource,
  type ForeignHooks,
  type HookDialect,
  type HostMarkers,
  type HookDialects,
  type HookEventSpec,
  type HookOutput,
  type HookTimeout,
  type LifecycleSwitch,
  type PayloadFields
} from "./domain/lifecycle/spi/hook-dialect.js";
export { heartbeatSignal, type HeartbeatSignal } from "./domain/lifecycle/policies/heartbeat-signal.js";
export {
  type LifecycleBlocker,
  type LifecycleEvent,
  type LifecycleMapping,
  type LifecycleOutcome,
  type LifecyclePhase,
  type LifecycleScope,
  type TerminalHost,
  type TerminalIdentity
} from "./domain/lifecycle/value-objects/lifecycle-event.js";
export { lifecycleStatus, reduceLifecycle } from "./domain/lifecycle/policies/reduce-lifecycle.js";
