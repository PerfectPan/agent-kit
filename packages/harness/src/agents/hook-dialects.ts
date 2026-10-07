import { AgentKitError, type BuiltinCodingAgentId, type CodingAgentId } from "@rivus/agent-kit-catalog";

import {
  type Env,
  type HookDialect,
  type HookDialects,
  type LifecycleEvent,
  readWithDialect,
  sniffSource,
  terminalIdentity
} from "../domain/lifecycle/index.js";
import { claudeCodeHookDialect } from "./claude-code/hook-dialect.js";
import { codexHookDialect } from "./codex/hook-dialect.js";
import { cursorHookDialect } from "./cursor/hook-dialect.js";
import { geminiCliHookDialect } from "./gemini-cli/hook-dialect.js";
import { grokHookDialect } from "./grok/hook-dialect.js";
import { opencodeHookDialect } from "./opencode/hook-dialect.js";
import { piHookDialect } from "./pi/hook-dialect.js";

export const builtinHookDialects: Readonly<Record<BuiltinCodingAgentId, HookDialect>> = {
  "claude-code": claudeCodeHookDialect,
  codex: codexHookDialect,
  cursor: cursorHookDialect,
  "gemini-cli": geminiCliHookDialect,
  grok: grokHookDialect,
  opencode: opencodeHookDialect,
  pi: piHookDialect
};

export interface ReadHookEventOptions {
  /** Dialects for this call, merged over `builtinHookDialects`, such as a third-party agent's. */
  readonly adapters?: HookDialects;
}

/**
 * Translates one hook payload, synchronously and without IO, so a hook process can load nothing else. The payload
 * is whatever the agent sent (parsed JSON on stdin, or the event object a plugin forwards), and `env` is the hook
 * process's environment. The agent is sniffed first, because Grok and Cursor also run hooks registered for Claude
 * Code: payload evidence (Grok's `hookEventName`, Cursor's `cursor_version`) decides, and the inherited
 * `CURSOR_VERSION` only counts for an agent whose hooks Cursor runs. An unknown payload shape or event reads as phase
 * `unknown` with the event name it carried; it never throws.
 *
 * Naming an agent without a dialect is a programming error: it throws an `AgentKitError` with code
 * `capability-unsupported`, whatever the payload.
 */
export function readHookEvent(
  agent: CodingAgentId,
  payload: unknown,
  env: Env,
  options: ReadHookEventOptions = {}
): LifecycleEvent {
  const dialects: HookDialects =
    options.adapters === undefined ? builtinHookDialects : { ...builtinHookDialects, ...options.adapters };
  const declared = Object.hasOwn(dialects, agent) ? dialects[agent] : undefined;
  if (declared === undefined) {
    throw new AgentKitError("capability-unsupported", `Agent "${agent}" has no hook dialect`);
  }
  const source = sniffSource(agent, payload, env, dialects);
  const dialect = Object.hasOwn(dialects, source) ? (dialects[source] ?? declared) : declared;
  const event = { ...readWithDialect(dialect, payload, env), agent: source };
  const terminal = terminalIdentity(env);
  return terminal === undefined ? event : { ...event, terminal };
}
