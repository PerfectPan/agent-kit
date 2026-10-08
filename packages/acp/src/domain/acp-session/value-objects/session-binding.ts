import type { CodingAgentId } from "@rivus/agent-kit-catalog";

/**
 * The caller's `sessionKey` bound to the ACP session that carries it, so a later connection can load that session.
 * A binding is removed when a cancel does not settle, because the agent may still be running the cancelled turn.
 */
export interface SessionBinding {
  readonly sessionKey: string;
  readonly agent: CodingAgentId;
  readonly sessionId: string;
  readonly cwd: string;
}

/**
 * The binding when the named agent made it. A store is shared by every agent, so a key may be bound to another
 * agent's session; to this connection that is no binding at all.
 */
export function bindingFor(agent: CodingAgentId, binding: SessionBinding | undefined): SessionBinding | undefined {
  return binding?.agent === agent ? binding : undefined;
}
