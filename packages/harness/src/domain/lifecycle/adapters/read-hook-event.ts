import { requireService, type CodingAgentId, type ServiceTable } from "@rivus/agent-kit-catalog";
import {
  type Env,
  type HookDialect,
  type LifecycleEvent,
  readWithDialect,
  sniffSource,
  terminalIdentity
} from "../index.js";
import { payloadView } from "./payload-shape.js";

export interface ReadHookEventOptions {
  readonly providers: { readonly hooks: ServiceTable<HookDialect> };
}

/**
 * Translates one hook payload, synchronously and without IO, so a hook process can load nothing else. The payload
 * is whatever the agent sent (parsed JSON on stdin, or the event object a plugin forwards), and `env` is the hook
 * process's environment. The payload is parsed into a view at this boundary, and every path the dialects read is a
 * chain of zod schemas, so an unexpected type reads as absent. Host markers choose the source before the
 * dialect reads the event. An unknown payload shape or event reads as phase
 * `unknown` with the event name it carried; it never throws.
 *
 * Naming an agent without a dialect is a programming error: it throws an `AgentKitError` with code
 * `capability-unsupported`, whatever the payload.
 */
export function readHookEvent(
  agent: CodingAgentId,
  payload: unknown,
  env: Env,
  options: ReadHookEventOptions
): LifecycleEvent {
  const dialects = options.providers.hooks;
  requireService(agent, dialects, "has no hook dialect");
  const view = payloadView(payload);
  const source = sniffSource(agent, view, env, dialects);
  const dialect = requireService(source, dialects, "has no hook dialect");
  const event = { ...readWithDialect(dialect, view, env), agent: source };
  const terminal = terminalIdentity(env);
  return terminal === undefined ? event : { ...event, terminal };
}
