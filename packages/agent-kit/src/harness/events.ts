export { builtinHookDialects } from "../providers/hooks.js";
import { readHookEvent as contextReadHookEvent } from "@rivus/agent-kit-harness/public/events";
import { hooksTable } from "../providers/hooks.js";
import type { ProviderOptions } from "../providers/types.js";

export type {
  FieldPath,
  HookDialect,
  HookEventSpec,
  HookOutput,
  LifecycleEvent,
  PayloadFields
} from "@rivus/agent-kit-harness/public/events";

type ReadHookEventOptions = ProviderOptions<Parameters<typeof contextReadHookEvent>[3]>;

export function readHookEvent(
  agent: Parameters<typeof contextReadHookEvent>[0],
  payload: Parameters<typeof contextReadHookEvent>[1],
  env: Parameters<typeof contextReadHookEvent>[2],
  options: ReadHookEventOptions = {}
): ReturnType<typeof contextReadHookEvent> {
  return contextReadHookEvent(agent, payload, env, { ...options, providers: { hooks: hooksTable(options.providers) } });
}
