export { heartbeatSignal, type HeartbeatSignal } from "./policies/heartbeat-signal.js";
export { duplicateHooks, type HookFinding, hookHealth, type HookProblem } from "./policies/hook-health.js";
export { sniffSource } from "./services/sniff-source.js";
export { terminalIdentity } from "./services/terminal-identity.js";
export type { Env } from "./policies/payload-fields.js";
export { lifecycleStatus, reduceLifecycle } from "./policies/reduce-lifecycle.js";
export { readWithDialect } from "./services/read-with-dialect.js";
export { aliasesOf, finishSelectorsOf } from "./spi/hook-dialect.js";
export type {
  FieldPath,
  FieldSource,
  FinishSelector,
  ForeignHooks,
  HookDialect,
  HostMarkers,
  HookDialects,
  HookEventSpec,
  HookOutput,
  HookTimeout,
  LifecycleSwitch,
  PayloadFields
} from "./spi/hook-dialect.js";
export type { PayloadView } from "./value-objects/payload-view.js";
export type {
  LifecycleBlocker,
  LifecycleEvent,
  LifecycleMapping,
  LifecycleOutcome,
  LifecyclePhase,
  LifecycleScope,
  TerminalHost,
  TerminalIdentity
} from "./value-objects/lifecycle-event.js";
export {
  type BlockSource,
  INITIAL_LIFECYCLE_STATE,
  type LifecycleClock,
  type LifecycleState,
  type LifecycleStatus
} from "./value-objects/lifecycle-state.js";
