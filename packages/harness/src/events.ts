// The hook-path entry, `@rivus/agent-kit/harness/events`: a hook process loads only this, so it reaches nothing but
// the lifecycle domain and the per-agent hook dialects.
export { builtinHookDialects, readHookEvent, type ReadHookEventOptions } from "./agents/hook-dialects.js";
export {
  type BlockSource,
  type FieldPath,
  type FieldSource,
  type ForeignHooks,
  heartbeatSignal,
  type HeartbeatSignal,
  type HookDialect,
  type HookDialects,
  type HookEventSpec,
  type HookOutput,
  type HookTimeout,
  INITIAL_LIFECYCLE_STATE,
  type LifecycleBlocker,
  type LifecycleClock,
  type LifecycleEvent,
  type LifecycleMapping,
  type LifecycleOutcome,
  type LifecyclePhase,
  type LifecycleScope,
  type LifecycleState,
  lifecycleStatus,
  type LifecycleStatus,
  type LifecycleSwitch,
  type PayloadFields,
  reduceLifecycle,
  type TerminalHost,
  type TerminalIdentity
} from "./domain/lifecycle/index.js";
